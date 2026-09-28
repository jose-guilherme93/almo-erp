import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { availableQuantity } from "@/server/services/stock/average-cost";
import { countBelowMinimum, listBelowMinimum, stockSummary } from "@/server/services/stock/alerts";
import { countInTransit } from "@/server/services/transfer";
import { responseInbox } from "@/server/services/notification/inbox";
import type { AuthContext } from "@/server/auth/context";
import { visibleBranchIds } from "@/server/auth/scope";

/**
 * Camada de agregação dos dashboards.
 *
 * Regra do AGENTS.md §7: cada indicador existe **uma única vez** aqui. Duas
 * telas nunca recalculam o mesmo número por caminhos diferentes — é assim que
 * o contador do sino e o do dashboard permanecem iguais.
 *
 * Todas as funções recebem o contexto e aplicam o escopo internamente.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * MS_PER_DAY);
}

/* -------------------------------------------------------------------------- */
/* Solicitações                                                               */
/* -------------------------------------------------------------------------- */

export async function requestsByStatus(branchIds: readonly string[]) {
  const rows = await prisma.request.groupBy({
    by: ["status"],
    where: { branchId: { in: [...branchIds] } },
    _count: { _all: true },
  });

  return rows.map((row) => ({ status: row.status, count: row._count._all }));
}

export async function pendingRequests(branchIds: readonly string[]): Promise<number> {
  return prisma.request.count({
    where: { branchId: { in: [...branchIds] }, status: { in: ["SUBMITTED", "IN_REVIEW"] } },
  });
}

export async function awaitingDelivery(branchIds: readonly string[]): Promise<number> {
  return prisma.request.count({
    where: {
      branchId: { in: [...branchIds] },
      status: { in: ["APPROVED", "PARTIALLY_APPROVED", "IN_PREPARATION"] },
    },
  });
}

/** Tempo médio entre envio e decisão, em horas. */
export async function averageApprovalHours(branchIds: readonly string[]): Promise<number | null> {
  const decided = await prisma.request.findMany({
    where: {
      branchId: { in: [...branchIds] },
      decidedAt: { not: null },
      createdAt: { gte: daysAgo(90) },
    },
    select: { createdAt: true, decidedAt: true },
  });

  if (decided.length === 0) return null;

  const totalHours = decided.reduce((total, request) => {
    if (!request.decidedAt) return total;

    return total + (request.decidedAt.getTime() - request.createdAt.getTime()) / (1000 * 60 * 60);
  }, 0);

  return totalHours / decided.length;
}

/** Solicitações aguardando decisão além do SLA, por unidade. */
export async function requestsAtRisk(branchIds: readonly string[], slaHours = 24): Promise<number> {
  return prisma.request.count({
    where: {
      branchId: { in: [...branchIds] },
      status: { in: ["SUBMITTED", "IN_REVIEW"] },
      createdAt: { lt: new Date(Date.now() - slaHours * 60 * 60 * 1000) },
    },
  });
}

/** Consumo (saídas) por material no período. */
export async function topConsumedItems(branchIds: readonly string[], from: Date, limit = 10) {
  const lines = await prisma.stockLine.findMany({
    where: {
      quantity: { lt: 0 },
      createdAt: { gte: from },
      stockDocument: { branchId: { in: [...branchIds] }, status: "POSTED" },
    },
    select: {
      quantity: true,
      lineTotal: true,
      item: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } },
    },
  });

  const byItem = new Map<
    string,
    {
      itemId: string;
      code: string;
      name: string;
      unitCode: string;
      quantity: Prisma.Decimal;
      value: Prisma.Decimal;
    }
  >();

  for (const line of lines) {
    const current = byItem.get(line.item.id) ?? {
      itemId: line.item.id,
      code: line.item.code,
      name: line.item.name,
      unitCode: line.item.unit.code,
      quantity: new Prisma.Decimal(0),
      value: new Prisma.Decimal(0),
    };

    byItem.set(line.item.id, {
      ...current,
      quantity: current.quantity.plus(line.quantity.abs()),
      value: current.value.plus(line.lineTotal),
    });
  }

  return [...byItem.values()]
    .sort((a, b) => b.quantity.comparedTo(a.quantity))
    .slice(0, limit)
    .map((row) => ({
      ...row,
      quantity: row.quantity.toString(),
      value: row.value.toString(),
    }));
}

/* -------------------------------------------------------------------------- */
/* Movimentações                                                              */
/* -------------------------------------------------------------------------- */

/** Entradas e saídas por semana, para o gráfico de fluxo. */
export async function movementTrend(branchIds: readonly string[], weeks = 12) {
  const from = daysAgo(weeks * 7);

  const lines = await prisma.stockLine.findMany({
    where: {
      createdAt: { gte: from },
      stockDocument: { branchId: { in: [...branchIds] }, status: "POSTED" },
    },
    select: { quantity: true, createdAt: true },
  });

  const buckets = new Map<string, { inbound: number; outbound: number }>();

  for (const line of lines) {
    const weekStart = new Date(line.createdAt);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    const key = weekStart.toISOString().slice(0, 10);
    const bucket = buckets.get(key) ?? { inbound: 0, outbound: 0 };

    if (line.quantity.isNegative()) {
      bucket.outbound += Math.abs(Number(line.quantity));
    } else {
      bucket.inbound += Number(line.quantity);
    }

    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, values]) => ({ week, ...values }));
}

/** Valor de estoque por filial, para o gráfico comparativo. */
export async function stockValueByBranch(branchIds: readonly string[]) {
  const branches = await prisma.branch.findMany({
    where: { id: { in: [...branchIds] }, active: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });

  const levels = await prisma.stockLevel.findMany({
    where: { branchId: { in: [...branchIds] }, quantity: { gt: 0 } },
    select: { branchId: true, quantity: true, averageCost: true },
  });

  const valueByBranch = new Map<string, Prisma.Decimal>();

  for (const level of levels) {
    const current = valueByBranch.get(level.branchId) ?? new Prisma.Decimal(0);

    valueByBranch.set(level.branchId, current.plus(level.quantity.times(level.averageCost)));
  }

  return branches.map((branch) => ({
    branchId: branch.id,
    code: branch.code,
    name: branch.name,
    value: Number(valueByBranch.get(branch.id) ?? 0),
  }));
}

/** Saldo por categoria na unidade. */
export async function stockByCategory(branchIds: readonly string[]) {
  const levels = await prisma.stockLevel.findMany({
    where: { branchId: { in: [...branchIds] }, quantity: { gt: 0 } },
    select: {
      quantity: true,
      averageCost: true,
      item: { select: { category: { select: { name: true } } } },
    },
  });

  const byCategory = new Map<string, { quantity: number; value: number }>();

  for (const level of levels) {
    const name = level.item.category.name;
    const current = byCategory.get(name) ?? { quantity: 0, value: 0 };

    byCategory.set(name, {
      quantity: current.quantity + Number(level.quantity),
      value: current.value + Number(level.quantity.times(level.averageCost)),
    });
  }

  return [...byCategory.entries()]
    .map(([category, values]) => ({ category, ...values }))
    .sort((a, b) => b.value - a.value);
}

/* -------------------------------------------------------------------------- */
/* KPIs por unidade                                                           */
/* -------------------------------------------------------------------------- */

export type BranchKpi = {
  branchId: string;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  active: boolean;
  stockValue: string;
  itemCount: number;
  pendingRequests: number;
  atRisk: number;
  belowMinimum: number;
  incomingTransfers: number;
  lastMovementAt: Date | null;
  responsibleName: string | null;
};

/** Uma linha por unidade, para a visão consolidada da matriz. */
export async function allBranchKpis(branchIds: readonly string[]): Promise<BranchKpi[]> {
  const branches = await prisma.branch.findMany({
    where: { id: { in: [...branchIds] } },
    orderBy: [{ type: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      city: true,
      state: true,
      active: true,
      warehouseResponsible: { select: { name: true } },
    },
  });

  const [levels, requestGroups, riskGroups, transfers, belowMinimum] = await Promise.all([
    prisma.stockLevel.findMany({
      where: { branchId: { in: [...branchIds] } },
      select: { branchId: true, quantity: true, averageCost: true, lastMovementAt: true },
    }),
    prisma.request.groupBy({
      by: ["branchId"],
      where: {
        branchId: { in: [...branchIds] },
        status: { in: ["SUBMITTED", "IN_REVIEW"] },
      },
      _count: { _all: true },
    }),
    prisma.request.groupBy({
      by: ["branchId"],
      where: {
        branchId: { in: [...branchIds] },
        status: { in: ["SUBMITTED", "IN_REVIEW"] },
        createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      _count: { _all: true },
    }),
    prisma.transfer.groupBy({
      by: ["destinationBranchId"],
      where: {
        destinationBranchId: { in: [...branchIds] },
        status: { in: ["SENT", "IN_TRANSIT"] },
      },
      _count: { _all: true },
    }),
    listBelowMinimum({ branchIds }),
  ]);

  const stockByBranch = new Map<
    string,
    { value: Prisma.Decimal; items: number; last: Date | null }
  >();

  for (const level of levels) {
    const current = stockByBranch.get(level.branchId) ?? {
      value: new Prisma.Decimal(0),
      items: 0,
      last: null,
    };

    const last =
      level.lastMovementAt && (!current.last || level.lastMovementAt > current.last)
        ? level.lastMovementAt
        : current.last;

    stockByBranch.set(level.branchId, {
      value: current.value.plus(level.quantity.times(level.averageCost)),
      items: current.items + (level.quantity.greaterThan(0) ? 1 : 0),
      last,
    });
  }

  const pendingByBranch = new Map(requestGroups.map((row) => [row.branchId, row._count._all]));
  const riskByBranch = new Map(riskGroups.map((row) => [row.branchId, row._count._all]));
  const transfersByBranch = new Map(
    transfers.map((row) => [row.destinationBranchId, row._count._all]),
  );
  const belowByBranch = new Map<string, number>();

  for (const row of belowMinimum) {
    belowByBranch.set(row.branchId, (belowByBranch.get(row.branchId) ?? 0) + 1);
  }

  return branches.map((branch) => {
    const stock = stockByBranch.get(branch.id);

    return {
      branchId: branch.id,
      code: branch.code,
      name: branch.name,
      city: branch.city,
      state: branch.state,
      active: branch.active,
      stockValue: (stock?.value ?? new Prisma.Decimal(0)).toString(),
      itemCount: stock?.items ?? 0,
      pendingRequests: pendingByBranch.get(branch.id) ?? 0,
      atRisk: riskByBranch.get(branch.id) ?? 0,
      belowMinimum: belowByBranch.get(branch.id) ?? 0,
      incomingTransfers: transfersByBranch.get(branch.id) ?? 0,
      lastMovementAt: stock?.last ?? null,
      responsibleName: branch.warehouseResponsible?.name ?? null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Dashboards                                                                 */
/* -------------------------------------------------------------------------- */

export type DashboardScope = "ALL_BRANCHES" | "OWN_BRANCHES";

/** Dashboard da matriz: consolidado de toda a rede. */
export async function getMatrixDashboard(context: AuthContext) {
  const branchIds = visibleBranchIds(context);

  const [
    summary,
    pending,
    atRisk,
    delivery,
    inTransit,
    belowMinimum,
    byStatus,
    avgHours,
    trend,
    byBranch,
    topItems,
    byCategory,
  ] = await Promise.all([
    stockSummary({ branchIds }),
    pendingRequests(branchIds),
    requestsAtRisk(branchIds),
    awaitingDelivery(branchIds),
    countInTransit(branchIds),
    countBelowMinimum({ branchIds }),
    requestsByStatus(branchIds),
    averageApprovalHours(branchIds),
    movementTrend(branchIds),
    stockValueByBranch(branchIds),
    topConsumedItems(branchIds, daysAgo(30)),
    stockByCategory(branchIds),
  ]);

  return {
    scope: "ALL_BRANCHES" as DashboardScope,
    branchCount: branchIds.length,
    stockValue: summary.totalValue.toString(),
    totalItems: summary.totalItems,
    totalQuantity: summary.totalQuantity.toString(),
    totalReserved: summary.totalReserved.toString(),
    pendingRequests: pending,
    requestsAtRisk: atRisk,
    awaitingDelivery: delivery,
    transfersInTransit: inTransit,
    belowMinimum,
    requestsByStatus: byStatus,
    averageApprovalHours: avgHours,
    movementTrend: trend,
    stockValueByBranch: byBranch,
    topConsumedItems: topItems,
    stockByCategory: byCategory,
  };
}

/** Dashboard da unidade: a mesa de trabalho de quem aprova. */
export async function getUnitDashboard(context: AuthContext, branchId: string) {
  const [
    summary,
    pending,
    atRisk,
    delivery,
    inTransit,
    belowMinimum,
    byStatus,
    trend,
    topItems,
    byCategory,
    inbox,
  ] = await Promise.all([
    stockSummary({ branchIds: [branchId] }),
    pendingRequests([branchId]),
    requestsAtRisk([branchId]),
    awaitingDelivery([branchId]),
    countInTransit([branchId]),
    countBelowMinimum({ branchId }),
    requestsByStatus([branchId]),
    movementTrend([branchId]),
    topConsumedItems([branchId], daysAgo(30), 5),
    stockByCategory([branchId]),
    responseInbox(context.user.id, [branchId]),
  ]);

  return {
    scope: "OWN_BRANCHES" as DashboardScope,
    branchId,
    stockValue: summary.totalValue.toString(),
    totalItems: summary.totalItems,
    totalQuantity: summary.totalQuantity.toString(),
    totalReserved: summary.totalReserved.toString(),
    pendingRequests: pending,
    requestsAtRisk: atRisk,
    awaitingDelivery: delivery,
    transfersInTransit: inTransit,
    belowMinimum,
    requestsByStatus: byStatus,
    movementTrend: trend,
    topConsumedItems: topItems,
    stockByCategory: byCategory,
    /** Contadores do topo: mesma fonte do sino. */
    inbox,
  };
}

/** Saldo disponível resumido de um material por unidade (usado em listas). */
export async function itemAvailabilityByBranch(itemId: string, branchIds: readonly string[]) {
  const levels = await prisma.stockLevel.findMany({
    where: { itemId, branchId: { in: [...branchIds] } },
    select: { branchId: true, quantity: true, reservedQuantity: true },
  });

  const byBranch = new Map<string, Prisma.Decimal>();

  for (const level of levels) {
    const current = byBranch.get(level.branchId) ?? new Prisma.Decimal(0);

    byBranch.set(
      level.branchId,
      current.plus(availableQuantity(level.quantity, level.reservedQuantity)),
    );
  }

  return byBranch;
}
