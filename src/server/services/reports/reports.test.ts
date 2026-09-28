/**
 * Testes dos relatórios.
 *
 * Provam o que a FASE 12 exige: o CSV sai com BOM e `;` (abre no Excel pt-BR) e
 * o relatório de consumo bate com a soma direta das saídas.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { makeAuthContext } from "@/test-utils/auth-context";
import { createAndPostStockDocument } from "@/server/services/stock/post-document";
import {
  buildScope,
  reportSupportsCategory,
  reportToCsv,
  runReport,
} from "@/server/services/reports";

const TEST_PREFIX = "RPT";
const ACTOR_EMAIL = "autor.relatorio@ator.teste.local";

const d = (value: string | number) => new Prisma.Decimal(value);

let databaseAvailable = false;
let actorId = "";
let branchId = "";
let locationId = "";
let itemId = "";
let unitId = "";
let categoryId = "";

function context() {
  return makeAuthContext({
    userId: actorId,
    networkPermissions: ["relatorio:read"],
    networkBranchIds: [branchId],
    activeBranchId: branchId,
  });
}

function scopeFor() {
  return buildScope(context(), {
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  });
}

async function cleanup(): Promise<void> {
  const items = await prisma.item.findMany({
    where: { code: { startsWith: `${TEST_PREFIX}-` } },
    select: { id: true },
  });
  const itemIds = items.map((item) => item.id);

  if (itemIds.length > 0) {
    await prisma.stockLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLevel.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.itemStockPolicy.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }

  await prisma.stockDocument.deleteMany({ where: { createdById: actorId } });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseAvailable = true;
  } catch {
    databaseAvailable = false;
    return;
  }

  const branch = await prisma.branch.findFirstOrThrow({
    where: { active: true },
    select: { id: true },
  });
  const location = await prisma.storageLocation.findFirstOrThrow({
    where: { branchId: branch.id },
    select: { id: true },
  });
  const unit = await prisma.unit.findFirstOrThrow({ where: { code: "UN" }, select: { id: true } });
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } });

  const actor = await prisma.user.upsert({
    where: { email: ACTOR_EMAIL },
    update: { status: "ACTIVE" },
    create: { email: ACTOR_EMAIL, name: "Autor Relatório", status: "ACTIVE" },
    select: { id: true },
  });

  branchId = branch.id;
  locationId = location.id;
  unitId = unit.id;
  categoryId = category.id;
  actorId = actor.id;
});

beforeEach(async () => {
  if (!databaseAvailable) return;

  await cleanup();

  const item = await prisma.item.create({
    data: {
      code: `${TEST_PREFIX}-0001`,
      name: "Material do Relatório",
      categoryId,
      unitId,
      referencePrice: d(10),
    },
    select: { id: true },
  });

  itemId = item.id;
});

afterAll(async () => {
  if (databaseAvailable) {
    await cleanup();
    await prisma.auditLog.deleteMany({ where: { actorId } });
    await prisma.user.deleteMany({ where: { email: ACTOR_EMAIL } });
  }

  await prisma.$disconnect();
});

describe.runIf(process.env["DATABASE_URL"])("consumo por material", () => {
  it("bate com a soma direta das saídas do período", async () => {
    await createAndPostStockDocument({
      type: "INBOUND",
      branchId,
      storageLocationId: locationId,
      createdById: actorId,
      referenceType: "TEST",
      lines: [{ itemId, quantity: d(100), unitCost: d(10) }],
    });

    await createAndPostStockDocument({
      type: "ISSUE",
      branchId,
      storageLocationId: locationId,
      createdById: actorId,
      referenceType: "TEST",
      lines: [{ itemId, quantity: d(-30) }],
    });

    const result = await runReport("consumo-material", scopeFor());

    const row = result.rows.find((entry) => entry[0] === `${TEST_PREFIX}-0001`);

    expect(row).toBeDefined();
    expect(row?.[3]).toBe("30");
    // 30 × custo médio 10 = 300
    expect(row?.[5]).toBe("300");
  });

  it("devolve vazio quando não há saída no período", async () => {
    await createAndPostStockDocument({
      type: "INBOUND",
      branchId,
      storageLocationId: locationId,
      createdById: actorId,
      referenceType: "TEST",
      lines: [{ itemId, quantity: d(10), unitCost: d(1) }],
    });

    const result = await runReport("consumo-material", scopeFor());

    // A unidade pode ter saídas de demonstração; o que importa é este
    // material não aparecer.
    expect(result.rows.some((row) => row[0] === `${TEST_PREFIX}-0001`)).toBe(false);
  });
});

describe.runIf(process.env["DATABASE_URL"])("valor de estoque", () => {
  it("lista o saldo com o valor calculado pelo custo médio", async () => {
    await createAndPostStockDocument({
      type: "INBOUND",
      branchId,
      storageLocationId: locationId,
      createdById: actorId,
      referenceType: "TEST",
      lines: [{ itemId, quantity: d(20), unitCost: d(7.5) }],
    });

    const result = await runReport("valor-estoque", scopeFor());

    const row = result.rows.find((entry) => entry[3] === `${TEST_PREFIX}-0001`);

    expect(row).toBeDefined();
    expect(row?.[4]).toBe("Material do Relatório");
    expect(row?.[6]).toBe("20");
    expect(row?.[9]).toBe("150");
  });
});

describe.runIf(process.env["DATABASE_URL"])("reposição", () => {
  it("lista item abaixo do mínimo com a falta calculada", async () => {
    await prisma.itemStockPolicy.create({
      data: { itemId, branchId, minimumQuantity: d(50) },
    });

    await createAndPostStockDocument({
      type: "INBOUND",
      branchId,
      storageLocationId: locationId,
      createdById: actorId,
      referenceType: "TEST",
      lines: [{ itemId, quantity: d(20), unitCost: d(5) }],
    });

    const result = await runReport("reposicao", scopeFor());

    const row = result.rows.find((entry) => entry[2] === `${TEST_PREFIX}-0001`);

    expect(row).toBeDefined();
    expect(row?.[4]).toBe("20");
    expect(row?.[5]).toBe("50");
    expect(row?.[6]).toBe("30");
    expect(row?.[8]).toBe("sem consumo");
  });

  it("não lista item acima do mínimo", async () => {
    await prisma.itemStockPolicy.create({
      data: { itemId, branchId, minimumQuantity: d(5) },
    });

    await createAndPostStockDocument({
      type: "INBOUND",
      branchId,
      storageLocationId: locationId,
      createdById: actorId,
      referenceType: "TEST",
      lines: [{ itemId, quantity: d(50), unitCost: d(5) }],
    });

    const result = await runReport("reposicao", scopeFor());

    // A unidade tem outros materiais do seed abaixo do mínimo; o que importa
    // é este não aparecer.
    expect(result.rows.some((row) => row[2] === `${TEST_PREFIX}-0001`)).toBe(false);
  });
});

describe.runIf(process.env["DATABASE_URL"])("itens sem política", () => {
  it("encontra material sem mínimo definido na unidade", async () => {
    const result = await runReport("sem-politica", scopeFor());

    expect(result.rows.some((row) => row[0] === `${TEST_PREFIX}-0001`)).toBe(true);
    expect(result.summary).toContain("sem mínimo definido");
  });

  it("não lista material com mínimo definido", async () => {
    await prisma.itemStockPolicy.create({
      data: { itemId, branchId, minimumQuantity: d(10) },
    });

    const result = await runReport("sem-politica", scopeFor());

    expect(result.rows.some((row) => row[0] === `${TEST_PREFIX}-0001`)).toBe(false);
  });
});

describe.runIf(process.env["DATABASE_URL"])("exportação CSV", () => {
  it("sai com BOM, ponto e vírgula e CRLF", async () => {
    await createAndPostStockDocument({
      type: "INBOUND",
      branchId,
      storageLocationId: locationId,
      createdById: actorId,
      referenceType: "TEST",
      lines: [{ itemId, quantity: d(5), unitCost: d(2) }],
    });

    const result = await runReport("valor-estoque", scopeFor());
    const csv = reportToCsv(result);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(";");
    expect(csv).toContain("\r\n");
    // O nome do material tem acento: sobrevive ao BOM.
    expect(csv).toContain("Relatório");
  });

  it("escapa material cujo nome tem ponto e vírgula", async () => {
    await prisma.item.update({
      where: { id: itemId },
      data: { name: "Papel; A4 75g" },
    });

    await createAndPostStockDocument({
      type: "INBOUND",
      branchId,
      storageLocationId: locationId,
      createdById: actorId,
      referenceType: "TEST",
      lines: [{ itemId, quantity: d(1), unitCost: d(1) }],
    });

    const csv = reportToCsv(await runReport("valor-estoque", scopeFor()));

    expect(csv).toContain('"Papel; A4 75g"');
  });
});

describe("metadados dos relatórios", () => {
  it("todo relatório devolve cabeçalho e resumo", async () => {
    if (!databaseAvailable) return;

    for (const reportId of [
      "consumo-material",
      "consumo-solicitante",
      "valor-estoque",
      "reposicao",
      "solicitacoes",
      "movimentacoes",
      "sem-movimento",
      "sem-politica",
    ] as const) {
      const result = await runReport(reportId, scopeFor());

      expect(result.headers.length).toBeGreaterThan(0);
      expect(result.summary.length).toBeGreaterThan(0);
    }
  });

  it("reportSupportsCategory marca os relatórios com filtro de categoria", () => {
    expect(reportSupportsCategory("valor-estoque")).toBe(true);
    expect(reportSupportsCategory("movimentacoes")).toBe(false);
  });
});
