import { Prisma } from "@/generated/prisma/client";

/**
 * Travamento de saldo de estoque.
 *
 * Toda alteração de saldo passa por aqui: sem o lock, duas saídas simultâneas
 * do mesmo item podem ler o mesmo saldo e gerar estoque negativo.
 *
 * Estratégia: `SELECT … FOR UPDATE` sobre as linhas de `stock_levels`,
 * **sempre em ordem determinística** (por id). A ordem importa: travamentos em
 * ordens diferentes entre transações concorrentes causam deadlock.
 */

export type StockLevelKey = {
  itemId: string;
  storageLocationId: string;
  branchId: string;
};

function keyOf(key: StockLevelKey): string {
  return `${key.itemId}:${key.storageLocationId}`;
}

/**
 * Garante que a linha de saldo exista e a devolve travada.
 *
 * Cria com saldo zero quando não existe — assim o chamador sempre tem uma
 * linha para atualizar, sem precisar de `if` espalhado.
 */
export async function lockStockLevels(
  tx: Prisma.TransactionClient,
  keys: readonly StockLevelKey[],
): Promise<
  Map<
    string,
    {
      id: string;
      quantity: Prisma.Decimal;
      reservedQuantity: Prisma.Decimal;
      averageCost: Prisma.Decimal;
      version: number;
    }
  >
> {
  const unique = new Map<string, StockLevelKey>();

  for (const key of keys) {
    unique.set(keyOf(key), key);
  }

  if (unique.size === 0) return new Map();

  // 1. Garante a existência das linhas (a constraint única protege a corrida).
  for (const key of unique.values()) {
    await tx.stockLevel.upsert({
      where: {
        itemId_storageLocationId: {
          itemId: key.itemId,
          storageLocationId: key.storageLocationId,
        },
      },
      update: {},
      create: {
        itemId: key.itemId,
        storageLocationId: key.storageLocationId,
        branchId: key.branchId,
        quantity: new Prisma.Decimal(0),
        reservedQuantity: new Prisma.Decimal(0),
      },
    });
  }

  // 2. Descobre os ids e trava em ordem determinística (evita deadlock).
  const rows = await tx.stockLevel.findMany({
    where: {
      OR: [...unique.values()].map((key) => ({
        itemId: key.itemId,
        storageLocationId: key.storageLocationId,
      })),
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  const ids = rows.map((row) => row.id);

  if (ids.length > 0) {
    await tx.$queryRaw`
      SELECT id FROM stock_levels
      WHERE id = ANY(${ids}::text[])
      ORDER BY id
      FOR UPDATE
    `;
  }

  // 3. Relê já travado.
  const levels = await tx.stockLevel.findMany({
    where: {
      OR: [...unique.values()].map((key) => ({
        itemId: key.itemId,
        storageLocationId: key.storageLocationId,
      })),
    },
    select: {
      id: true,
      itemId: true,
      storageLocationId: true,
      quantity: true,
      reservedQuantity: true,
      averageCost: true,
      version: true,
    },
  });

  const result = new Map<
    string,
    {
      id: string;
      quantity: Prisma.Decimal;
      reservedQuantity: Prisma.Decimal;
      averageCost: Prisma.Decimal;
      version: number;
    }
  >();

  for (const level of levels) {
    result.set(`${level.itemId}:${level.storageLocationId}`, {
      id: level.id,
      quantity: level.quantity,
      reservedQuantity: level.reservedQuantity,
      averageCost: level.averageCost,
      version: level.version,
    });
  }

  return result;
}

export { keyOf as stockLevelKey };
