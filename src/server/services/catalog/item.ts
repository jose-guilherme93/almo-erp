import { Prisma } from "@/generated/prisma/client";
import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import type {
  ItemInput,
  ItemLotInput,
  ItemStockPolicyInput,
  ItemUpdateInput,
} from "@/lib/validation/catalog";
import { writeAuditLog } from "@/server/services/audit";
import type { AuthContext } from "@/server/auth/context";
import { assertBranchAccess, visibleBranchIds } from "@/server/auth/scope";

/** Serviço do catálogo de materiais. */

const SKU_SEQUENCE_LENGTH = 4;

/**
 * Gera o próximo SKU a partir do prefixo da categoria (ex.: `EPI-0007`).
 *
 * Olha o maior código existente com o prefixo em vez de contar registros:
 * assim excluir um material não faz o próximo reaproveitar um código já usado.
 */
export async function generateItemCode(categoryId: string): Promise<string> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { code: true },
  });

  if (!category) throw new NotFoundError("Categoria");

  // Usa a raiz do código: EPI-CABECA vira prefixo EPI.
  const prefix = category.code.split("-")[0] ?? category.code;

  const last = await prisma.item.findFirst({
    where: { code: { startsWith: `${prefix}-` } },
    orderBy: { code: "desc" },
    select: { code: true },
  });

  const lastNumber = last ? Number(last.code.slice(prefix.length + 1)) : 0;
  const next = (Number.isFinite(lastNumber) ? lastNumber : 0) + 1;

  return `${prefix}-${String(next).padStart(SKU_SEQUENCE_LENGTH, "0")}`;
}

export type ItemListFilters = {
  search?: string;
  categoryId?: string | null;
  unitId?: string | null;
  status?: string | null;
  onlyBelowMinimum?: boolean;
  onlyWithoutPolicy?: boolean;
  page?: number;
  pageSize?: number;
};

export async function listItems(context: AuthContext, filters: ItemListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const branchId = context.activeBranchId;

  const where: PrismaTypes.ItemWhereInput = {
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.unitId ? { unitId: filters.unitId } : {}),
    ...(filters.status === "active" ? { active: true } : {}),
    ...(filters.status === "inactive" ? { active: false } : {}),
    ...(filters.onlyWithoutPolicy
      ? { stockPolicies: { none: { branchId: branchId ?? "__none__" } } }
      : {}),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" } },
            { code: { contains: filters.search, mode: "insensitive" } },
            { barcode: { contains: filters.search } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.item.findMany({
      where,
      orderBy: { code: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        code: true,
        barcode: true,
        name: true,
        referencePrice: true,
        controlledByLot: true,
        perishable: true,
        requiresApproval: true,
        active: true,
        category: { select: { id: true, code: true, name: true } },
        unit: { select: { id: true, code: true, name: true } },
        stockPolicies: {
          where: branchId ? { branchId } : undefined,
          select: { minimumQuantity: true },
        },
      },
    }),
    prisma.item.count({ where }),
  ]);

  // Saldo disponível na unidade ativa, em uma consulta só.
  const balances =
    branchId && items.length > 0
      ? await prisma.stockLevel.groupBy({
          by: ["itemId"],
          where: { branchId, itemId: { in: items.map((item) => item.id) } },
          _sum: { quantity: true, reservedQuantity: true },
        })
      : [];

  // `_sum` de Decimal vem como `Decimal | number`: normalizamos para Decimal
  // e nunca comparamos quantidade como ponto flutuante (AGENTS.md §3.5).
  const balanceByItem = new Map(
    balances.map((row) => [
      row.itemId,
      {
        quantity: new Prisma.Decimal(row._sum.quantity ?? 0),
        reserved: new Prisma.Decimal(row._sum.reservedQuantity ?? 0),
      },
    ]),
  );

  const rows = items.map((item) => {
    const balance = balanceByItem.get(item.id);
    const minimum = item.stockPolicies[0]?.minimumQuantity ?? null;
    const available = balance ? balance.quantity.minus(balance.reserved) : null;

    return {
      ...item,
      minimumQuantity: minimum,
      availableQuantity: available,
      belowMinimum: minimum !== null && available !== null ? available.lessThan(minimum) : false,
    };
  });

  const filtered =
    filters.onlyBelowMinimum === true ? rows.filter((row) => row.belowMinimum) : rows;

  return {
    items: filtered,
    total: filters.onlyBelowMinimum === true ? filtered.length : total,
    page,
    pageSize,
    totalPages: Math.max(
      1,
      Math.ceil((filters.onlyBelowMinimum ? filtered.length : total) / pageSize),
    ),
  };
}

export async function getItemDetail(context: AuthContext, itemId: string) {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      code: true,
      barcode: true,
      name: true,
      description: true,
      referencePrice: true,
      controlledByLot: true,
      perishable: true,
      requiresApproval: true,
      hasSerialControl: true,
      active: true,
      createdAt: true,
      category: { select: { id: true, code: true, name: true, requiresApproval: true } },
      unit: { select: { id: true, code: true, name: true, allowsDecimals: true } },
      lots: {
        orderBy: [{ expirationDate: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          expirationDate: true,
          initialQuantity: true,
          active: true,
        },
      },
      stockPolicies: {
        orderBy: { branch: { code: "asc" } },
        select: {
          id: true,
          minimumQuantity: true,
          maximumQuantity: true,
          alertQuantity: true,
          averageConsumption: true,
          branch: { select: { id: true, code: true, name: true } },
        },
      },
      stockLevels: {
        where: { branchId: { in: visibleBranchIds(context) } },
        orderBy: { branch: { code: "asc" } },
        select: {
          id: true,
          quantity: true,
          reservedQuantity: true,
          averageCost: true,
          lastMovementAt: true,
          branch: { select: { id: true, code: true, name: true } },
          storageLocation: { select: { id: true, code: true, name: true } },
        },
      },
    },
  });

  if (!item) throw new NotFoundError("Material");

  return item;
}

/** Busca de material por código de barras — usada pelo leitor. */
export async function findItemByBarcode(barcode: string) {
  const digits = barcode.replace(/\D+/g, "");
  if (digits.length === 0) return null;

  return prisma.item.findFirst({
    where: { active: true, barcode: digits },
    select: {
      id: true,
      code: true,
      barcode: true,
      name: true,
      unit: { select: { id: true, code: true, name: true } },
      category: { select: { id: true, name: true } },
      controlledByLot: true,
    },
  });
}

/** Autocomplete de material: nome, código ou código de barras. */
export async function searchItems(term: string, limit = 20) {
  const search = term.trim();

  const where: PrismaTypes.ItemWhereInput = {
    active: true,
    ...(search.length > 0
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { code: { contains: search, mode: "insensitive" } },
            { barcode: { contains: search.replace(/\D+/g, "") } },
          ],
        }
      : {}),
  };

  return prisma.item.findMany({
    where,
    orderBy: { name: "asc" },
    take: limit,
    select: {
      id: true,
      code: true,
      barcode: true,
      name: true,
      controlledByLot: true,
      unit: { select: { code: true, allowsDecimals: true } },
      category: { select: { name: true } },
    },
  });
}

export async function createItem(
  context: AuthContext,
  input: ItemInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true, requiresApproval: true },
  });

  if (!category) throw new NotFoundError("Categoria");

  const code = input.code ?? (await generateItemCode(input.categoryId));

  const taken = await prisma.item.findUnique({ where: { code }, select: { id: true } });
  if (taken) throw new ConflictError(`Já existe um material com o código ${code}.`);

  if (input.barcode) {
    const barcodeTaken = await prisma.item.findUnique({
      where: { barcode: input.barcode },
      select: { id: true },
    });

    if (barcodeTaken) {
      throw new ConflictError("Já existe um material com este código de barras.");
    }
  }

  return prisma.$transaction(async (tx) => {
    const item = await tx.item.create({
      data: {
        code,
        barcode: input.barcode,
        name: input.name,
        description: input.description,
        categoryId: input.categoryId,
        unitId: input.unitId,
        referencePrice: input.referencePrice,
        controlledByLot: input.controlledByLot,
        perishable: input.perishable,
        // A categoria define o padrão; o item pode sobrescrever.
        requiresApproval: input.requiresApproval || category.requiresApproval,
        hasSerialControl: input.hasSerialControl,
        active: input.active,
        createdById: context.user.id,
      },
      select: { id: true, code: true },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "item.created",
        entityType: "Item",
        entityId: item.id,
        after: { ...input, code },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return item;
  });
}

export async function updateItem(
  context: AuthContext,
  input: ItemUpdateInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const current = await prisma.item.findUnique({
    where: { id: input.itemId },
    select: { id: true, code: true, barcode: true, name: true, active: true },
  });

  if (!current) throw new NotFoundError("Material");

  if (input.code !== current.code) {
    const taken = await prisma.item.findUnique({
      where: { code: input.code },
      select: { id: true },
    });

    if (taken && taken.id !== input.itemId) {
      throw new ConflictError(`Já existe um material com o código ${input.code}.`);
    }
  }

  if (input.barcode && input.barcode !== current.barcode) {
    const taken = await prisma.item.findUnique({
      where: { barcode: input.barcode },
      select: { id: true },
    });

    if (taken && taken.id !== input.itemId) {
      throw new ConflictError("Já existe um material com este código de barras.");
    }
  }

  return prisma.$transaction(async (tx) => {
    await tx.item.update({
      where: { id: input.itemId },
      data: {
        code: input.code,
        barcode: input.barcode,
        name: input.name,
        description: input.description,
        categoryId: input.categoryId,
        unitId: input.unitId,
        referencePrice: input.referencePrice,
        controlledByLot: input.controlledByLot,
        perishable: input.perishable,
        requiresApproval: input.requiresApproval,
        hasSerialControl: input.hasSerialControl,
        active: input.active,
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "item.updated",
        entityType: "Item",
        entityId: input.itemId,
        before: {
          code: current.code,
          name: current.name,
          barcode: current.barcode,
          active: current.active,
        },
        after: input,
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}

export async function deactivateItem(
  context: AuthContext,
  itemId: string,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, name: true, active: true },
  });

  if (!item) throw new NotFoundError("Material");

  const withBalance = await prisma.stockLevel.aggregate({
    where: { itemId, quantity: { gt: 0 } },
    _count: { _all: true },
  });

  if (withBalance._count._all > 0) {
    throw new BusinessRuleError(
      `Este material ainda tem saldo em ${withBalance._count._all} local(is). Zere ou transfira o estoque antes de desativar.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.item.update({ where: { id: itemId }, data: { active: false } });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "item.deactivated",
        entityType: "Item",
        entityId: itemId,
        before: { active: true },
        after: { active: false },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Lotes                                                                       */
/* -------------------------------------------------------------------------- */

export async function createItemLot(
  context: AuthContext,
  input: ItemLotInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const item = await prisma.item.findUnique({
    where: { id: input.itemId },
    select: { id: true, controlledByLot: true },
  });

  if (!item) throw new NotFoundError("Material");

  if (!item.controlledByLot) {
    throw new BusinessRuleError(
      "Este material não é controlado por lote. Marque o controle por lote antes de cadastrar lotes.",
    );
  }

  const taken = await prisma.itemLot.findFirst({
    where: { itemId: input.itemId, code: input.code },
    select: { id: true },
  });

  if (taken) throw new ConflictError(`Já existe o lote ${input.code} para este material.`);

  return prisma.$transaction(async (tx) => {
    const lot = await tx.itemLot.create({
      data: {
        itemId: input.itemId,
        code: input.code,
        expirationDate: input.expirationDate,
        active: input.active,
      },
      select: { id: true },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "item_lot.created",
        entityType: "ItemLot",
        entityId: lot.id,
        after: { ...input, expirationDate: input.expirationDate?.toISOString() },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return lot;
  });
}

export async function deactivateItemLot(
  context: AuthContext,
  lotId: string,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const lot = await prisma.itemLot.findUnique({
    where: { id: lotId },
    select: { id: true, code: true, itemId: true },
  });

  if (!lot) throw new NotFoundError("Lote");

  return prisma.$transaction(async (tx) => {
    await tx.itemLot.update({ where: { id: lotId }, data: { active: false } });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "item_lot.deactivated",
        entityType: "ItemLot",
        entityId: lotId,
        after: { active: false },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Política de estoque por unidade                                             */
/* -------------------------------------------------------------------------- */

export async function assignStockPolicy(
  context: AuthContext,
  input: ItemStockPolicyInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  for (const branchId of input.branchIds) {
    assertBranchAccess(context, branchId);
  }

  const item = await prisma.item.findUnique({
    where: { id: input.itemId },
    select: { id: true, name: true },
  });

  if (!item) throw new NotFoundError("Material");

  return prisma.$transaction(async (tx) => {
    for (const branchId of input.branchIds) {
      await tx.itemStockPolicy.upsert({
        where: { itemId_branchId: { itemId: input.itemId, branchId } },
        update: {
          minimumQuantity: input.minimumQuantity,
          maximumQuantity: input.maximumQuantity ?? null,
          alertQuantity: input.alertQuantity ?? null,
          averageConsumption: input.averageConsumption ?? null,
        },
        create: {
          itemId: input.itemId,
          branchId,
          minimumQuantity: input.minimumQuantity,
          maximumQuantity: input.maximumQuantity ?? null,
          alertQuantity: input.alertQuantity ?? null,
          averageConsumption: input.averageConsumption ?? null,
        },
      });
    }

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "item_stock_policy.assigned",
        entityType: "Item",
        entityId: input.itemId,
        after: {
          branchIds: input.branchIds,
          minimumQuantity: input.minimumQuantity,
          maximumQuantity: input.maximumQuantity ?? null,
        },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return { branches: input.branchIds.length };
  });
}

export async function removeStockPolicy(
  context: AuthContext,
  policyId: string,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const policy = await prisma.itemStockPolicy.findUnique({
    where: { id: policyId },
    select: { id: true, branchId: true, itemId: true, minimumQuantity: true },
  });

  if (!policy) throw new NotFoundError("Política de estoque");

  assertBranchAccess(context, policy.branchId);

  return prisma.$transaction(async (tx) => {
    await tx.itemStockPolicy.delete({ where: { id: policyId } });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "item_stock_policy.removed",
        entityType: "Item",
        entityId: policy.itemId,
        branchId: policy.branchId,
        before: { minimumQuantity: policy.minimumQuantity },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}
