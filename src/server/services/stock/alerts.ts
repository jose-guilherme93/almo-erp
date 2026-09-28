import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { availableQuantity } from "@/server/services/stock/average-cost";

/**
 * Alertas de estoque.
 *
 * Esta é a **fonte única** de "itens abaixo do mínimo" — o dashboard, o
 * alerta de notificação e o relatório de reposição consomem daqui, para os
 * números nunca divergirem (AGENTS.md §7).
 */

export type BelowMinimumRow = {
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  minimumQuantity: Prisma.Decimal;
  availableQuantity: Prisma.Decimal;
  shortage: Prisma.Decimal;
  storageLocationName: string | null;
};

type AlertFilters = {
  /** Filiais a considerar. `undefined` = todas (visão de rede). */
  branchIds?: readonly string[];
  branchId?: string;
  categoryId?: string;
  limit?: number;
};

/**
 * Itens cujo saldo disponível está abaixo do mínimo definido para a unidade.
 *
 * O cálculo é feito em memória a partir de políticas + saldos: a comparação
 * envolve `Decimal` e o `take` precisa ser aplicado **depois** do filtro, senão
 * paginaríamos itens que não são alerta.
 */
export async function listBelowMinimum(options: AlertFilters = {}): Promise<BelowMinimumRow[]> {
  const policyWhere: Prisma.ItemStockPolicyWhereInput = {
    ...(options.branchId ? { branchId: options.branchId } : {}),
    ...(options.branchIds && options.branchIds.length > 0
      ? { branchId: { in: [...options.branchIds] } }
      : {}),
    ...(options.categoryId ? { item: { categoryId: options.categoryId } } : {}),
    minimumQuantity: { gt: 0 },
    item: { active: true },
    branch: { active: true },
  };

  const policies = await prisma.itemStockPolicy.findMany({
    where: policyWhere,
    select: {
      minimumQuantity: true,
      item: {
        select: {
          id: true,
          code: true,
          name: true,
          unit: { select: { code: true } },
        },
      },
      branch: { select: { id: true, code: true, name: true } },
    },
  });

  if (policies.length === 0) return [];

  const itemIds = [...new Set(policies.map((policy) => policy.item.id))];
  const branchIds = [...new Set(policies.map((policy) => policy.branch.id))];

  const levels = await prisma.stockLevel.findMany({
    where: { itemId: { in: itemIds }, branchId: { in: branchIds } },
    select: {
      itemId: true,
      branchId: true,
      quantity: true,
      reservedQuantity: true,
      storageLocation: { select: { name: true } },
    },
  });

  const availableByKey = new Map<string, { total: Prisma.Decimal; locationName: string | null }>();

  for (const level of levels) {
    const key = `${level.itemId}:${level.branchId}`;
    const current = availableByKey.get(key) ?? {
      total: new Prisma.Decimal(0),
      locationName: level.storageLocation.name,
    };

    availableByKey.set(key, {
      total: current.total.plus(availableQuantity(level.quantity, level.reservedQuantity)),
      locationName: current.locationName,
    });
  }

  const rows: BelowMinimumRow[] = [];

  for (const policy of policies) {
    const key = `${policy.item.id}:${policy.branch.id}`;
    const balance = availableByKey.get(key);

    const available = balance?.total ?? new Prisma.Decimal(0);

    if (available.greaterThanOrEqualTo(policy.minimumQuantity)) continue;

    rows.push({
      itemId: policy.item.id,
      itemCode: policy.item.code,
      itemName: policy.item.name,
      unitCode: policy.item.unit.code,
      branchId: policy.branch.id,
      branchCode: policy.branch.code,
      branchName: policy.branch.name,
      minimumQuantity: policy.minimumQuantity,
      availableQuantity: available,
      shortage: policy.minimumQuantity.minus(available),
      storageLocationName: balance?.locationName ?? null,
    });
  }

  // Mais crítico primeiro: maior percentual de falta, depois maior falta.
  rows.sort((a, b) => {
    const ratioA = a.minimumQuantity.isZero()
      ? new Prisma.Decimal(0)
      : a.shortage.dividedBy(a.minimumQuantity);
    const ratioB = b.minimumQuantity.isZero()
      ? new Prisma.Decimal(0)
      : b.shortage.dividedBy(b.minimumQuantity);

    return ratioB.comparedTo(ratioA);
  });

  return options.limit ? rows.slice(0, options.limit) : rows;
}

/** Contagem de itens abaixo do mínimo, para cards de dashboard. */
export async function countBelowMinimum(options: AlertFilters = {}): Promise<number> {
  const rows = await listBelowMinimum(options);

  return rows.length;
}

/**
 * Indicadores de estoque de um conjunto de filiais.
 *
 * Uma consulta agregada só — dashboards não podem fazer N+1 (FASE 10).
 */
export async function stockSummary(options: { branchIds?: readonly string[] } = {}): Promise<{
  totalItems: number;
  totalQuantity: Prisma.Decimal;
  totalReserved: Prisma.Decimal;
  totalValue: Prisma.Decimal;
  belowMinimum: number;
}> {
  const where: Prisma.StockLevelWhereInput =
    options.branchIds && options.branchIds.length > 0
      ? { branchId: { in: [...options.branchIds] } }
      : {};

  const aggregate = await prisma.stockLevel.aggregate({
    where,
    _sum: { quantity: true, reservedQuantity: true },
    _count: { _all: true },
  });

  // Valor do estoque exige quantidade × custo médio linha a linha: agregar no
  // banco com Precisao seria incorreto.
  const levels = await prisma.stockLevel.findMany({
    where: { ...where, quantity: { gt: 0 } },
    select: { quantity: true, averageCost: true },
  });

  const totalValue = levels.reduce(
    (total, level) => total.plus(level.quantity.times(level.averageCost)),
    new Prisma.Decimal(0),
  );

  return {
    totalItems: aggregate._count._all,
    totalQuantity: new Prisma.Decimal(aggregate._sum.quantity ?? 0),
    totalReserved: new Prisma.Decimal(aggregate._sum.reservedQuantity ?? 0),
    totalValue,
    belowMinimum: await countBelowMinimum(options),
  };
}
