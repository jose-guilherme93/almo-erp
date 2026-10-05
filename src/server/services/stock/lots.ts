import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { InsufficientStockError } from "@/lib/errors";
import { formatQuantity } from "@/lib/format";

/**
 * Lotes válidos por material, para os formulários de movimentação.
 *
 * Devolve um mapa `itemId → lotes`, porque o formulário precisa do lote de
 * cada linha sem fazer uma ida ao servidor por material. Lotes vencidos ficam
 * de fora: o motor de estoque os recusaria de qualquer forma.
 */
export async function listActiveLots(
  branchId: string,
): Promise<Record<string, Array<{ id: string; code: string; expirationDate: string | null }>>> {
  const lots = await prisma.itemLot.findMany({
    where: {
      active: true,
      item: { active: true, controlledByLot: true },
      OR: [{ expirationDate: null }, { expirationDate: { gt: new Date() } }],
    },
    orderBy: [{ expirationDate: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      expirationDate: true,
      itemId: true,
      item: { select: { stockLevels: { where: { branchId }, select: { id: true } } } },
    },
  });

  const result: Record<
    string,
    Array<{ id: string; code: string; expirationDate: string | null }>
  > = {};

  for (const lot of lots) {
    // Só interessa lote de material que já tem (ou terá) saldo nesta unidade.
    const key = lot.itemId;
    const entry = result[key] ?? [];

    entry.push({
      id: lot.id,
      code: lot.code,
      expirationDate: lot.expirationDate
        ? lot.expirationDate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
        : null,
    });

    result[key] = entry;
  }

  return result;
}

/**
 * Escolhe o lote para uma quantidade de um material controlado por lote.
 *
 * A seleção é FEFO (o que vence primeiro sai primeiro) e a quantidade do lote é
 * conferida contra o próprio ledger (`StockLine`), que é a verdade do estoque.
 * Para material sem controle de lote devolve `null`.
 *
 * `fallbackToFirstLot` serve para ajuste de inventário de sobra: material
 * encontrado sem lote específico entra no lote de validade mais próxima.
 */
export async function resolveLotForItem(
  tx: Prisma.TransactionClient,
  input: {
    branchId: string;
    itemId: string;
    quantity: Prisma.Decimal;
    fallbackToFirstLot?: boolean;
  },
): Promise<string | null> {
  const item = await tx.item.findUniqueOrThrow({
    where: { id: input.itemId },
    select: { name: true, controlledByLot: true },
  });

  if (!item.controlledByLot) return null;

  const lots = await tx.itemLot.findMany({
    where: {
      itemId: input.itemId,
      active: true,
      OR: [{ expirationDate: null }, { expirationDate: { gt: new Date() } }],
    },
    orderBy: [{ expirationDate: { sort: "asc", nulls: "last" } }, { code: "asc" }],
    select: { id: true },
  });

  if (lots.length === 0) {
    if (input.fallbackToFirstLot) return null;
    throw new InsufficientStockError(item.name, formatQuantity(input.quantity), "0");
  }

  const lotIds = lots.map((lot) => lot.id);

  const grouped = await tx.stockLine.groupBy({
    by: ["itemLotId"],
    where: {
      itemId: input.itemId,
      itemLotId: { in: lotIds },
      stockDocument: { branchId: input.branchId },
    },
    _sum: { quantity: true },
  });

  const balance = new Map(
    grouped.map((row) => [row.itemLotId, row._sum.quantity ?? new Prisma.Decimal(0)]),
  );

  let best = new Prisma.Decimal(0);

  for (const lot of lots) {
    const available = balance.get(lot.id) ?? new Prisma.Decimal(0);

    if (available.greaterThanOrEqualTo(input.quantity)) return lot.id;

    if (available.greaterThan(best)) best = available;
  }

  if (input.fallbackToFirstLot) return lots[0]?.id ?? null;

  throw new InsufficientStockError(item.name, formatQuantity(input.quantity), formatQuantity(best));
}
