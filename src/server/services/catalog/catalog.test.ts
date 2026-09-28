/**
 * Testes de integração do catálogo de materiais.
 *
 * Cobrem o que a FASE 05 exige: geração de SKU, unicidade de código de
 * barras, herança da regra de aprovação e o bloqueio de desativar material
 * com saldo.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { makeAuthContext } from "@/test-utils/auth-context";
import {
  assignStockPolicy,
  createItem,
  deactivateItem,
  findItemByBarcode,
  generateItemCode,
  listItems,
  searchItems,
} from "@/server/services/catalog/item";

const TEST_PREFIX = "TST";
const ACTOR_EMAIL = "autor.catalogo@ator.teste.local";

/**
 * Códigos de barras válidos para os testes.
 *
 * Usam o prefixo 200, reservado para uso interno (não existe em produto real),
 * para não colidir com os materiais do seed.
 */
const TEST_BARCODES = {
  a: "2000000000015",
  b: "2000000000022",
  c: "2000000000039",
} as const;

let databaseAvailable = false;
let actorId = "";
let categoryId = "";
let categoryWithApprovalId = "";
let unitId = "";
let branchId = "";
let otherBranchId = "";

function catalogContext() {
  return makeAuthContext({
    userId: actorId,
    networkPermissions: ["item:read", "item:create", "item:manage"],
    networkBranchIds: [branchId, otherBranchId],
    activeBranchId: branchId,
  });
}

/**
 * Código de categoria dos testes.
 *
 * Usa o prefixo `TST-` de propósito: o gerador de SKU corta o código no
 * primeiro hífen, então os materiais saem como `TST-0001` e a limpeza
 * consegue encontrá-los pelo prefixo.
 */
function uniqueCategoryCode(): string {
  // O sufixo aleatório evita colisão quando duas categorias são criadas no
  // mesmo milissegundo (o CI rápido esbarrava nisso). Sem hífen extra para
  // não mexer no prefixo que o gerador de SKU usa.
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();

  return `${TEST_PREFIX}-${Date.now().toString(36).toUpperCase()}${suffix}`;
}

async function cleanup(): Promise<void> {
  const categories = await prisma.category.findMany({
    where: { code: { startsWith: `${TEST_PREFIX}-` } },
    select: { id: true },
  });

  const categoryIds = categories.map((category) => category.id);

  const items = await prisma.item.findMany({
    where: {
      OR: [
        { code: { startsWith: `${TEST_PREFIX}-` } },
        ...(categoryIds.length > 0 ? [{ categoryId: { in: categoryIds } }] : []),
      ],
    },
    select: { id: true },
  });

  const itemIds = items.map((item) => item.id);

  // Ordem: dependentes do material, material, categoria.
  if (itemIds.length > 0) {
    await prisma.stockLevel.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.itemStockPolicy.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.itemLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }

  if (categoryIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: categoryIds } } });
    await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
  }
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseAvailable = true;
  } catch {
    databaseAvailable = false;
    return;
  }

  const unit = await prisma.unit.findFirstOrThrow({
    where: { active: true },
    select: { id: true },
  });
  const branches = await prisma.branch.findMany({
    where: { active: true },
    take: 2,
    select: { id: true },
  });

  const actor = await prisma.user.upsert({
    where: { email: ACTOR_EMAIL },
    update: { status: "ACTIVE" },
    create: { email: ACTOR_EMAIL, name: "Autor Catálogo", status: "ACTIVE" },
    select: { id: true },
  });

  unitId = unit.id;
  branchId = branches[0]?.id ?? "";
  otherBranchId = branches[1]?.id ?? "";
  actorId = actor.id;

  if (!branchId || !otherBranchId) databaseAvailable = false;
});

beforeEach(async () => {
  if (!databaseAvailable) return;

  await cleanup();

  const plain = await prisma.category.create({
    data: { code: uniqueCategoryCode(), name: "Categoria de Teste", requiresApproval: false },
    select: { id: true },
  });

  const restricted = await prisma.category.create({
    data: {
      code: uniqueCategoryCode(),
      name: "Categoria com Aprovação",
      requiresApproval: true,
    },
    select: { id: true },
  });

  categoryId = plain.id;
  categoryWithApprovalId = restricted.id;
});

afterAll(async () => {
  if (databaseAvailable) {
    await cleanup();

    const actor = await prisma.user.findUnique({
      where: { email: ACTOR_EMAIL },
      select: { id: true },
    });

    if (actor) {
      await prisma.auditLog.deleteMany({ where: { actorId: actor.id } });
      await prisma.user.delete({ where: { id: actor.id } });
    }
  }

  await prisma.$disconnect();
});

describe.runIf(process.env["DATABASE_URL"])("geração de código", () => {
  it("gera o primeiro código com o prefixo da categoria", async () => {
    const code = await generateItemCode(categoryId);

    expect(code).toMatch(/^TST-\d{4}$/);
  });

  it("incrementa a partir do maior código existente", async () => {
    const first = await createItem(catalogContext(), {
      name: "Material A",
      categoryId,
      unitId,
      referencePrice: 10,
      controlledByLot: false,
      perishable: false,
      requiresApproval: false,
      hasSerialControl: false,
      active: true,
      code: undefined,
      barcode: undefined,
      description: undefined,
    });

    const second = await generateItemCode(categoryId);

    expect(second).not.toBe(first.code);
    expect(Number(second.split("-")[1])).toBeGreaterThan(Number(first.code.split("-")[1]));
  });
});

describe.runIf(process.env["DATABASE_URL"])("criação", () => {
  const base = {
    name: "Material de Teste",
    referencePrice: 25.5,
    controlledByLot: false,
    perishable: false,
    requiresApproval: false,
    hasSerialControl: false,
    active: true,
    description: undefined,
    barcode: undefined,
  };

  it("herda a exigência de aprovação da categoria", async () => {
    const item = await createItem(catalogContext(), {
      ...base,
      categoryId: categoryWithApprovalId,
      unitId,
      code: undefined,
    });

    const saved = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });

    expect(saved.requiresApproval).toBe(true);
  });

  it("recusa código de barras já usado", async () => {
    await createItem(catalogContext(), {
      ...base,
      categoryId,
      unitId,
      code: undefined,
      barcode: TEST_BARCODES.a,
    });

    await expect(
      createItem(catalogContext(), {
        ...base,
        name: "Outro material",
        categoryId,
        unitId,
        code: undefined,
        barcode: TEST_BARCODES.a,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("encontra o material pelo código de barras", async () => {
    await createItem(catalogContext(), {
      ...base,
      categoryId,
      unitId,
      code: undefined,
      barcode: TEST_BARCODES.b,
    });

    const found = await findItemByBarcode("2000 0000 00022");

    expect(found?.name).toBe("Material de Teste");
  });
});

describe.runIf(process.env["DATABASE_URL"])("política de estoque", () => {
  it("define o mínimo para várias unidades de uma vez", async () => {
    const item = await createItem(catalogContext(), {
      name: "Com Mínimo",
      categoryId,
      unitId,
      referencePrice: 5,
      controlledByLot: false,
      perishable: false,
      requiresApproval: false,
      hasSerialControl: false,
      active: true,
      code: undefined,
      barcode: undefined,
      description: undefined,
    });

    const result = await assignStockPolicy(catalogContext(), {
      itemId: item.id,
      branchIds: [branchId, otherBranchId],
      minimumQuantity: 15,
      maximumQuantity: undefined,
      alertQuantity: undefined,
      averageConsumption: undefined,
    });

    expect(result.branches).toBe(2);

    const policies = await prisma.itemStockPolicy.findMany({ where: { itemId: item.id } });

    expect(policies).toHaveLength(2);
  });

  it("não define mínimo em unidade fora do escopo", async () => {
    const item = await createItem(catalogContext(), {
      name: "Fora do Escopo",
      categoryId,
      unitId,
      referencePrice: 5,
      controlledByLot: false,
      perishable: false,
      requiresApproval: false,
      hasSerialControl: false,
      active: true,
      code: undefined,
      barcode: undefined,
      description: undefined,
    });

    const restricted = makeAuthContext({
      userId: actorId,
      memberships: [{ branchId, roleSlug: "ALMOXARIFE" }],
      permissions: ["item:read", "item:manage"],
      activeBranchId: branchId,
    });

    await expect(
      assignStockPolicy(restricted, {
        itemId: item.id,
        branchIds: [otherBranchId],
        minimumQuantity: 5,
        maximumQuantity: undefined,
        alertQuantity: undefined,
        averageConsumption: undefined,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe.runIf(process.env["DATABASE_URL"])("desativação", () => {
  it("bloqueia desativar material com saldo", async () => {
    const item = await createItem(catalogContext(), {
      name: "Com Saldo",
      categoryId,
      unitId,
      referencePrice: 5,
      controlledByLot: false,
      perishable: false,
      requiresApproval: false,
      hasSerialControl: false,
      active: true,
      code: undefined,
      barcode: undefined,
      description: undefined,
    });

    const location = await prisma.storageLocation.findFirstOrThrow({
      where: { branchId },
      select: { id: true },
    });

    await prisma.stockLevel.create({
      data: {
        itemId: item.id,
        storageLocationId: location.id,
        branchId,
        quantity: "3.0000",
      },
    });

    await expect(deactivateItem(catalogContext(), item.id)).rejects.toMatchObject({
      code: "BUSINESS_RULE",
    });
  });

  it("desativa material sem saldo", async () => {
    const item = await createItem(catalogContext(), {
      name: "Sem Saldo",
      categoryId,
      unitId,
      referencePrice: 5,
      controlledByLot: false,
      perishable: false,
      requiresApproval: false,
      hasSerialControl: false,
      active: true,
      code: undefined,
      barcode: undefined,
      description: undefined,
    });

    await deactivateItem(catalogContext(), item.id);

    const saved = await prisma.item.findUniqueOrThrow({
      where: { id: item.id },
      select: { active: true },
    });

    expect(saved.active).toBe(false);
  });
});

describe.runIf(process.env["DATABASE_URL"])("busca", () => {
  it("não devolve material inativo no autocomplete", async () => {
    const item = await createItem(catalogContext(), {
      name: "Material Invisível",
      categoryId,
      unitId,
      referencePrice: 5,
      controlledByLot: false,
      perishable: false,
      requiresApproval: false,
      hasSerialControl: false,
      active: true,
      code: undefined,
      barcode: undefined,
      description: undefined,
    });

    await prisma.item.update({ where: { id: item.id }, data: { active: false } });

    const results = await searchItems("Material Invisível");

    expect(results.map((entry) => entry.id)).not.toContain(item.id);
  });

  it("filtra por material sem mínimo definido na unidade", async () => {
    await createItem(catalogContext(), {
      name: "Sem Politica Definida",
      categoryId,
      unitId,
      referencePrice: 5,
      controlledByLot: false,
      perishable: false,
      requiresApproval: false,
      hasSerialControl: false,
      active: true,
      code: undefined,
      barcode: undefined,
      description: undefined,
    });

    const result = await listItems(catalogContext(), { onlyWithoutPolicy: true, pageSize: 100 });

    expect(result.items.some((entry) => entry.name === "Sem Politica Definida")).toBe(true);
  });
});
