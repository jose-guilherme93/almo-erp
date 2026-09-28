import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { availableQuantity } from "@/server/services/stock/average-cost";
import type { AuthContext } from "@/server/auth/context";
import { resolveWorkingBranch } from "@/server/auth/scope";

/**
 * Consulta de saldos.
 *
 * Trabalha sempre sobre a **filial ativa** — saldo é por local, e local
 * pertence a uma unidade. A visão de rede aparece no dashboard (FASE 10), não
 * misturada na operação diária.
 */

export type StockLevelFilters = {
  search?: string;
  categoryId?: string | null;
  storageLocationId?: string | null;
  onlyBelowMinimum?: boolean;
  onlyWithoutMovementDays?: number | null;
  page?: number;
  pageSize?: number;
};

export type StockLevelRow = {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  categoryName: string;
  storageLocationName: string;
  quantity: string;
  reservedQuantity: string;
  availableQuantity: string;
  averageCost: string;
  totalValue: string;
  minimumQuantity: string | null;
  belowMinimum: boolean;
  lastMovementAt: Date | null;
};

export async function listStockLevels(
  context: AuthContext,
  filters: StockLevelFilters = {},
): Promise<{
  items: StockLevelRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const branchId = resolveWorkingBranch(context, null);

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));

  const where: Prisma.StockLevelWhereInput = {
    branchId,
    ...(filters.storageLocationId ? { storageLocationId: filters.storageLocationId } : {}),
    ...(filters.onlyWithoutMovementDays
      ? {
          OR: [
            { lastMovementAt: null },
            {
              lastMovementAt: {
                lt: new Date(Date.now() - filters.onlyWithoutMovementDays * 24 * 60 * 60 * 1000),
              },
            },
          ],
        }
      : {}),
    item: {
      active: true,
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: "insensitive" } },
              { code: { contains: filters.search, mode: "insensitive" } },
              { barcode: { contains: filters.search } },
            ],
          }
        : {}),
    },
  };

  const rows = await prisma.stockLevel.findMany({
    where,
    orderBy: [{ item: { name: "asc" } }, { storageLocation: { name: "asc" } }],
    select: {
      id: true,
      quantity: true,
      reservedQuantity: true,
      averageCost: true,
      lastMovementAt: true,
      item: {
        select: {
          id: true,
          code: true,
          name: true,
          unit: { select: { code: true } },
          category: { select: { name: true } },
          stockPolicies: {
            where: { branchId },
            select: { minimumQuantity: true },
          },
        },
      },
      storageLocation: { select: { name: true } },
    },
  });

  const mapped: StockLevelRow[] = rows.map((row) => {
    const minimum = row.item.stockPolicies[0]?.minimumQuantity ?? null;
    const available = availableQuantity(row.quantity, row.reservedQuantity);
    const totalValue = row.quantity.times(row.averageCost);

    return {
      id: row.id,
      itemId: row.item.id,
      itemCode: row.item.code,
      itemName: row.item.name,
      unitCode: row.item.unit.code,
      categoryName: row.item.category.name,
      storageLocationName: row.storageLocation.name,
      quantity: row.quantity.toString(),
      reservedQuantity: row.reservedQuantity.toString(),
      availableQuantity: available.toString(),
      averageCost: row.averageCost.toString(),
      totalValue: totalValue.toString(),
      minimumQuantity: minimum?.toString() ?? null,
      belowMinimum: minimum !== null && available.lessThan(minimum),
      lastMovementAt: row.lastMovementAt,
    };
  });

  const filtered =
    filters.onlyBelowMinimum === true ? mapped.filter((row) => row.belowMinimum) : mapped;

  const total = filtered.length;

  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Totais da filial ativa, para o cabeçalho da tela de saldos. */
export async function stockLevelsSummary(context: AuthContext): Promise<{
  totalItems: number;
  totalQuantity: Prisma.Decimal;
  totalValue: Prisma.Decimal;
  formattedValue: string;
}> {
  const branchId = resolveWorkingBranch(context, null);

  const levels = await prisma.stockLevel.findMany({
    where: { branchId, quantity: { gt: 0 } },
    select: { quantity: true, averageCost: true },
  });

  const totalQuantity = levels.reduce(
    (total, level) => total.plus(level.quantity),
    new Prisma.Decimal(0),
  );
  const totalValue = levels.reduce(
    (total, level) => total.plus(level.quantity.times(level.averageCost)),
    new Prisma.Decimal(0),
  );

  return {
    totalItems: levels.length,
    totalQuantity,
    totalValue,
    formattedValue: formatCurrency(totalValue),
  };
}
