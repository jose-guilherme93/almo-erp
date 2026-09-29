/**
 * Testes do motor de movimentação de estoque.
 *
 * É a regra mais crítica do sistema: se estes testes passarem, o saldo não
 * fica negativo, o custo médio está certo e a trilha é append-only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  cancelStockDocument,
  createAndPostStockDocument,
} from "@/server/services/stock/post-document";
import { lockStockLevels } from "@/server/services/stock/lock";

const TEST_PREFIX = "STK";
const ACTOR_EMAIL = "autor.estoque@ator.teste.local";

const d = (value: string | number) => new Prisma.Decimal(value);

let databaseAvailable = false;
let actorId = "";
let branchId = "";
let locationId = "";
let unitId = "";
let categoryId = "";
let itemId = "";
let lotItemId = "";
let lotId = "";
let expiredLotId = "";
let decimalItemId = "";

async function cleanup(): Promise<void> {
  const items = await prisma.item.findMany({
    where: { code: { startsWith: `${TEST_PREFIX}-` } },
    select: { id: true },
  });
  const itemIds = items.map((item) => item.id);

  if (itemIds.length > 0) {
    await prisma.stockLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockDocument.deleteMany({
      where: { branchId, referenceType: { startsWith: "TEST" } },
    });
    await prisma.stockDocument.deleteMany({
      where: { branchId, createdById: actorId, notes: { startsWith: "teste" } },
    });
    await prisma.stockLevel.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockReservation.deleteMany({
      where: { stockLevel: { itemId: { in: itemIds } } },
    });
    await prisma.itemStockPolicy.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.itemLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }

  await prisma.stockDocument.deleteMany({
    where: { number: { startsWith: "MV-" }, branchId, createdById: actorId },
  });
}

async function currentQuantity(item: string): Promise<string> {
  const level = await prisma.stockLevel.findFirst({
    where: { itemId: item, storageLocationId: locationId },
    select: { quantity: true, reservedQuantity: true, averageCost: true },
  });

  return level?.quantity.toString() ?? "0";
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
  const unit = await prisma.unit.findFirstOrThrow({
    where: { code: "UN" },
    select: { id: true },
  });
  const decimalUnit = await prisma.unit.findFirstOrThrow({
    where: { code: "KG" },
    select: { id: true },
  });
  const category = await prisma.category.findFirstOrThrow({
    where: { active: true },
    select: { id: true },
  });

  const actor = await prisma.user.upsert({
    where: { email: ACTOR_EMAIL },
    update: { status: "ACTIVE" },
    create: { email: ACTOR_EMAIL, name: "Autor Estoque", status: "ACTIVE" },
    select: { id: true },
  });

  branchId = branch.id;
  locationId = location.id;
  unitId = unit.id;
  categoryId = category.id;
  actorId = actor.id;

  const plain = await prisma.item.create({
    data: {
      code: `${TEST_PREFIX}-0001`,
      name: "Material de Estoque",
      categoryId,
      unitId,
      referencePrice: d(10),
    },
    select: { id: true },
  });

  const decimal = await prisma.item.create({
    data: {
      code: `${TEST_PREFIX}-0002`,
      name: "Material Fracionado",
      categoryId,
      unitId: decimalUnit.id,
      referencePrice: d(10),
    },
    select: { id: true },
  });

  const lotItem = await prisma.item.create({
    data: {
      code: `${TEST_PREFIX}-0003`,
      name: "Material com Lote",
      categoryId,
      unitId,
      referencePrice: d(10),
      controlledByLot: true,
      perishable: true,
    },
    select: { id: true },
  });

  itemId = plain.id;
  decimalItemId = decimal.id;
  lotItemId = lotItem.id;

  const validLot = await prisma.itemLot.create({
    data: {
      itemId: lotItem.id,
      code: "LOTE-VALIDO",
      expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });

  const expiredLot = await prisma.itemLot.create({
    data: {
      itemId: lotItem.id,
      code: "LOTE-VENCIDO",
      expirationDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
    select: { id: true },
  });

  lotId = validLot.id;
  expiredLotId = expiredLot.id;
});

beforeEach(async () => {
  if (!databaseAvailable) return;

  // Limpa apenas os saldos dos materiais deste teste: outros arquivos de
  // teste usam a mesma filial.
  await prisma.stockLevel.deleteMany({
    where: { itemId: { in: [itemId, lotItemId, decimalItemId] } },
  });
});

afterAll(async () => {
  if (databaseAvailable) {
    await cleanup();

    const actor = await prisma.user.findUnique({
      where: { email: ACTOR_EMAIL },
      select: { id: true },
    });

    if (actor) {
      await prisma.stockLine.deleteMany({ where: { stockDocument: { createdById: actor.id } } });
      await prisma.stockDocument.deleteMany({ where: { createdById: actor.id } });
      await prisma.auditLog.deleteMany({ where: { actorId: actor.id } });
      await prisma.user.delete({ where: { id: actor.id } });
    }
  }

  await prisma.$disconnect();
});

type PostType = Parameters<typeof createAndPostStockDocument>[0]["type"];

function post(
  lines: Parameters<typeof createAndPostStockDocument>[0]["lines"],
  type: PostType = "INBOUND",
) {
  return createAndPostStockDocument({
    type,
    branchId,
    storageLocationId: locationId,
    createdById: actorId,
    notes: "teste automatizado",
    referenceType: "TEST",
    lines,
  });
}

describe.runIf(process.env["DATABASE_URL"])("entrada", () => {
  it("cria saldo e grava linha positiva", async () => {
    const result = await post([{ itemId, quantity: d(100), unitCost: d(10) }]);

    expect(await currentQuantity(itemId)).toBe("100");

    const line = await prisma.stockLine.findFirstOrThrow({
      where: { stockDocumentId: result.documentId },
    });

    expect(line.quantity.toString()).toBe("100");
    expect(line.lineTotal.toString()).toBe("1000");
  });

  it("calcula o custo médio ponderado", async () => {
    await post([{ itemId, quantity: d(10), unitCost: d(10) }]);
    await post([{ itemId, quantity: d(10), unitCost: d(20) }]);

    const level = await prisma.stockLevel.findFirstOrThrow({
      where: { itemId, storageLocationId: locationId },
    });

    // (10×10 + 10×20) / 20 = 15
    expect(level.averageCost.toString()).toBe("15");
    expect(level.quantity.toString()).toBe("20");
  });

  it("gera número sequencial no formato MV-ANO-SEQUENCIAL", async () => {
    const first = await post([{ itemId, quantity: d(1), unitCost: d(1) }]);
    const second = await post([{ itemId, quantity: d(1), unitCost: d(1) }]);

    expect(first.number).toMatch(/^MV-\d{4}-\d{6}$/);
    expect(Number(second.number.split("-")[2])).toBe(Number(first.number.split("-")[2]) + 1);
  });

  it("recusa quantidade fracionada em unidade inteira", async () => {
    await expect(post([{ itemId, quantity: d("1.5"), unitCost: d(10) }])).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });
  });

  it("aceita quantidade fracionada em unidade decimal", async () => {
    await post([{ itemId: decimalItemId, quantity: d("1.5"), unitCost: d(10) }]);

    expect(await currentQuantity(decimalItemId)).toBe("1.5");
  });
});

describe.runIf(process.env["DATABASE_URL"])("saída", () => {
  it("debita o saldo", async () => {
    await post([{ itemId, quantity: d(50), unitCost: d(8) }]);
    await post([{ itemId, quantity: d(-20) }], "ISSUE");

    expect(await currentQuantity(itemId)).toBe("30");
  });

  it("recusa saída maior que o saldo e não altera nada", async () => {
    await post([{ itemId, quantity: d(10), unitCost: d(5) }]);

    await expect(post([{ itemId, quantity: d(-11) }], "ISSUE")).rejects.toMatchObject({
      code: "INSUFFICIENT_STOCK",
    });

    expect(await currentQuantity(itemId)).toBe("10");
  });

  it("recusa saída que consumiria o saldo reservado", async () => {
    await post([{ itemId, quantity: d(10), unitCost: d(5) }]);

    const level = await prisma.stockLevel.findFirstOrThrow({
      where: { itemId, storageLocationId: locationId },
    });

    await prisma.stockLevel.update({
      where: { id: level.id },
      data: { reservedQuantity: d(8) },
    });

    // Disponíveis são 2; pedir 5 deve falhar.
    await expect(post([{ itemId, quantity: d(-5) }], "ISSUE")).rejects.toMatchObject({
      code: "INSUFFICIENT_STOCK",
    });
  });

  it("entrega consome a reserva e o saldo", async () => {
    await post([{ itemId, quantity: d(10), unitCost: d(5) }]);

    const level = await prisma.stockLevel.findFirstOrThrow({
      where: { itemId, storageLocationId: locationId },
    });

    await prisma.stockLevel.update({
      where: { id: level.id },
      data: { reservedQuantity: d(5) },
    });

    await post([{ itemId, quantity: d(-5), releaseReserved: d(5) }], "ISSUE");

    const updated = await prisma.stockLevel.findFirstOrThrow({ where: { id: level.id } });

    expect(updated.quantity.toString()).toBe("5");
    expect(updated.reservedQuantity.toString()).toBe("0");
  });
});

describe.runIf(process.env["DATABASE_URL"])("validações de linha", () => {
  it("recusa documento sem linhas", async () => {
    await expect(post([])).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("recusa quantidade zero", async () => {
    await expect(post([{ itemId, quantity: d(0) }])).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });
  });

  it("recusa o mesmo material repetido no documento", async () => {
    await expect(
      post([
        { itemId, quantity: d(1), unitCost: d(1) },
        { itemId, quantity: d(2), unitCost: d(1) },
      ]),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("exige lote para material controlado", async () => {
    await expect(
      post([{ itemId: lotItemId, quantity: d(1), unitCost: d(1) }]),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("recusa lote vencido", async () => {
    await expect(
      post([{ itemId: lotItemId, itemLotId: expiredLotId, quantity: d(1), unitCost: d(1) }]),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("aceita lote válido", async () => {
    await post([{ itemId: lotItemId, itemLotId: lotId, quantity: d(3), unitCost: d(2) }]);

    expect(await currentQuantity(lotItemId)).toBe("3");
  });

  it("recusa lote em material que não é controlado por lote", async () => {
    await expect(
      post([{ itemId, itemLotId: lotId, quantity: d(1), unitCost: d(1) }]),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});

describe.runIf(process.env["DATABASE_URL"])("estorno", () => {
  it("gera documento inverso e devolve o saldo", async () => {
    const entrada = await post([{ itemId, quantity: d(30), unitCost: d(4) }]);

    expect(await currentQuantity(itemId)).toBe("30");

    await cancelStockDocument({
      documentId: entrada.documentId,
      createdById: actorId,
      reason: "erro de digitação",
    });

    expect(await currentQuantity(itemId)).toBe("0");

    const original = await prisma.stockDocument.findUniqueOrThrow({
      where: { id: entrada.documentId },
      select: { status: true, reversalDocumentId: true },
    });

    expect(original.status).toBe("CANCELLED");
    expect(original.reversalDocumentId).not.toBeNull();
  });

  it("não cancela duas vezes", async () => {
    const entrada = await post([{ itemId, quantity: d(5), unitCost: d(1) }]);

    await cancelStockDocument({
      documentId: entrada.documentId,
      createdById: actorId,
      reason: "primeiro",
    });

    await expect(
      cancelStockDocument({
        documentId: entrada.documentId,
        createdById: actorId,
        reason: "segundo",
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("recusa cancelar movimentação gerada por um fluxo de negócio", async () => {
    await post([{ itemId, quantity: d(5), unitCost: d(1) }]);

    const saida = await createAndPostStockDocument({
      type: "ISSUE",
      branchId,
      storageLocationId: locationId,
      createdById: actorId,
      notes: "teste automatizado",
      referenceType: "REQUEST",
      referenceId: "solicitacao-qualquer",
      lines: [{ itemId, quantity: d(-1) }],
    });

    await expect(
      cancelStockDocument({
        documentId: saida.documentId,
        createdById: actorId,
        reason: "cancelar por fora",
      }),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("preserva as linhas originais (ledger append-only)", async () => {
    const entrada = await post([{ itemId, quantity: d(7), unitCost: d(3) }]);

    await cancelStockDocument({
      documentId: entrada.documentId,
      createdById: actorId,
      reason: "teste",
    });

    const lines = await prisma.stockLine.findMany({
      where: { stockDocumentId: entrada.documentId },
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity.toString()).toBe("7");
  });
});

describe.runIf(process.env["DATABASE_URL"])("concorrência", () => {
  it("duas saídas simultâneas não geram saldo negativo", async () => {
    await post([{ itemId, quantity: d(10), unitCost: d(1) }]);

    const attempt = () =>
      createAndPostStockDocument({
        type: "ISSUE",
        branchId,
        storageLocationId: locationId,
        createdById: actorId,
        notes: "teste concorrente",
        referenceType: "TEST",
        lines: [{ itemId, quantity: d(-8) }],
      });

    const results = await Promise.allSettled([attempt(), attempt()]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");

    expect(fulfilled).toHaveLength(1);

    const quantity = await currentQuantity(itemId);
    expect(Number(quantity)).toBeGreaterThanOrEqual(0);
    expect(Number(quantity)).toBe(2);
  });

  it("lockStockLevels cria a linha quando ela não existe", async () => {
    const result = await prisma.$transaction(async (tx) => {
      const levels = await lockStockLevels(tx, [
        { itemId, storageLocationId: locationId, branchId },
      ]);

      return levels.get(`${itemId}:${locationId}`);
    });

    expect(result).toBeDefined();
    expect(result?.quantity.toString()).toBe("0");
  });
});
