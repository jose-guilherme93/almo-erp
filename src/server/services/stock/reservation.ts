import type { Prisma } from "@/generated/prisma/client";
import { BusinessRuleError, InsufficientStockError, NotFoundError } from "@/lib/errors";
import { formatQuantity } from "@/lib/format";
import { availableQuantity } from "@/server/services/stock/average-cost";
import { lockItemLevels, lockStockLevelById } from "@/server/services/stock/lock";
import { resolveLotForItem } from "@/server/services/stock/lots";

/**
 * Reserva de estoque.
 *
 * Reserva é o que impede aprovar uma solicitação que não tem saldo: no ato da
 * aprovação o material sai do "disponível" e passa a "reservado" para aquele
 * pedido. Só a entrega transforma reserva em saída real.
 *
 * A reserva é por local (`StockLevel`), não por filial: na entrega o
 * almoxarife precisa saber de qual prateleira tirar.
 */

export type ReservationRequest = {
  requestLineId: string;
  itemId: string;
  quantity: Prisma.Decimal;
};

/**
 * Local de onde o material será separado: o que tem mais disponível.
 *
 * Recebe os níveis **já travados** (`lockItemLevels`), para que a escolha e a
 * reserva aconteçam sob o mesmo lock — sem isso, duas aprovações simultâneas
 * leem o mesmo disponível e super-reservam.
 */
function pickLocationForItem(levels: Awaited<ReturnType<typeof lockItemLevels>>): {
  stockLevelId: string;
  available: Prisma.Decimal;
} {
  if (levels.length === 0) {
    throw new BusinessRuleError(
      "Este material não tem estoque nesta unidade. Solicite transferência antes de aprovar.",
    );
  }

  const active = levels.filter((level) => level.storageLocation.active);

  if (active.length === 0) {
    throw new BusinessRuleError("Nenhum local ativo com estoque para este material.");
  }

  const ranked = active
    .map((level) => ({
      id: level.id,
      type: level.storageLocation.type,
      available: availableQuantity(level.quantity, level.reservedQuantity),
    }))
    // Prefere o almoxarifado principal e, depois, maior disponibilidade.
    .sort((a, b) => {
      if (a.type === "MAIN_WAREHOUSE" && b.type !== "MAIN_WAREHOUSE") return -1;
      if (b.type === "MAIN_WAREHOUSE" && a.type !== "MAIN_WAREHOUSE") return 1;
      return b.available.comparedTo(a.available);
    });

  const best = ranked[0];

  if (!best) {
    throw new BusinessRuleError("Nenhum local ativo com estoque para este material.");
  }

  return { stockLevelId: best.id, available: best.available };
}

/**
 * Reserva saldo para as linhas de uma solicitação aprovada.
 *
 * Lança `InsufficientStockError` se qualquer linha não tiver saldo — o
 * aprovador precisa saber exatamente o que falta para decidir aprovar parcial.
 */
export async function reserveStock(
  tx: Prisma.TransactionClient,
  input: {
    branchId: string;
    createdById: string;
    lines: readonly ReservationRequest[];
  },
): Promise<Array<{ requestLineId: string; stockLevelId: string; quantity: Prisma.Decimal }>> {
  const created: Array<{
    requestLineId: string;
    stockLevelId: string;
    quantity: Prisma.Decimal;
  }> = [];

  for (const line of input.lines) {
    // Só reserva quantidade positiva: zero não reserva nada.
    if (!line.quantity.greaterThan(0)) continue;

    // Trava todo o saldo do item na filial antes de escolher a prateleira: a
    // escolha e o incremento precisam ser atômicos frente a outra aprovação.
    const levels = await lockItemLevels(tx, { itemId: line.itemId, branchId: input.branchId });
    const { stockLevelId, available } = pickLocationForItem(levels);

    if (line.quantity.greaterThan(available)) {
      const item = await tx.item.findUniqueOrThrow({
        where: { id: line.itemId },
        select: { name: true },
      });

      throw new InsufficientStockError(
        item.name,
        formatQuantity(line.quantity),
        formatQuantity(available),
      );
    }

    // Material controlado por lote reserva um lote concreto (FEFO). A escolha
    // acontece sob o lock do saldo para não super-alocar o mesmo lote.
    const lotId = await resolveLotForItem(tx, {
      branchId: input.branchId,
      itemId: line.itemId,
      quantity: line.quantity,
    });

    const existing = await tx.stockReservation.findUnique({
      where: { requestLineId: line.requestLineId },
      select: { id: true, status: true, quantity: true, stockLevelId: true },
    });

    if (existing?.status === "ACTIVE") {
      throw new BusinessRuleError("Esta linha já tem reserva ativa.");
    }

    const reservation = existing
      ? await tx.stockReservation.update({
          where: { id: existing.id },
          data: {
            stockLevelId,
            lotId,
            quantity: line.quantity,
            status: "ACTIVE",
            createdById: input.createdById,
          },
          select: { id: true, stockLevelId: true, quantity: true },
        })
      : await tx.stockReservation.create({
          data: {
            requestLineId: line.requestLineId,
            stockLevelId,
            lotId,
            quantity: line.quantity,
            status: "ACTIVE",
            createdById: input.createdById,
          },
          select: { id: true, stockLevelId: true, quantity: true },
        });

    await tx.stockLevel.update({
      where: { id: stockLevelId },
      data: { reservedQuantity: { increment: line.quantity } },
    });

    created.push({
      requestLineId: line.requestLineId,
      stockLevelId: reservation.stockLevelId,
      quantity: reservation.quantity,
    });
  }

  return created;
}

/** Libera a reserva (rejeição, cancelamento ou sobra na entrega). */
export async function releaseReservation(
  tx: Prisma.TransactionClient,
  input: { requestLineId: string; quantity?: Prisma.Decimal },
): Promise<void> {
  const reservation = await tx.stockReservation.findUnique({
    where: { requestLineId: input.requestLineId },
    select: { id: true, stockLevelId: true, quantity: true, status: true },
  });

  if (!reservation || reservation.status !== "ACTIVE") return;

  const toRelease = input.quantity ?? reservation.quantity;

  if (toRelease.greaterThan(reservation.quantity)) {
    throw new BusinessRuleError("Não é possível liberar mais do que foi reservado.");
  }

  // Trava a linha antes de ler/gravar: sem isso, liberar e consumir ao mesmo
  // tempo no mesmo saldo deixa `reservedQuantity` inconsistente.
  await lockStockLevelById(tx, reservation.stockLevelId);

  const level = await tx.stockLevel.findUniqueOrThrow({
    where: { id: reservation.stockLevelId },
    select: { reservedQuantity: true },
  });

  if (toRelease.greaterThan(level.reservedQuantity)) {
    throw new BusinessRuleError(
      "Reserva inconsistente: a liberação é maior que o reservado neste saldo.",
    );
  }

  await tx.stockLevel.update({
    where: { id: reservation.stockLevelId },
    data: {
      reservedQuantity: level.reservedQuantity.minus(toRelease),
    },
  });

  if (toRelease.greaterThanOrEqualTo(reservation.quantity)) {
    await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { status: "RELEASED" },
    });
  } else {
    await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { quantity: reservation.quantity.minus(toRelease) },
    });
  }
}

/** Marca a reserva como consumida — usado na entrega, junto com a saída. */
export async function consumeReservation(
  tx: Prisma.TransactionClient,
  input: { requestLineId: string; quantity: Prisma.Decimal },
): Promise<void> {
  const reservation = await tx.stockReservation.findUnique({
    where: { requestLineId: input.requestLineId },
    select: { id: true, quantity: true, status: true, stockLevelId: true },
  });

  if (!reservation || reservation.status !== "ACTIVE") {
    throw new NotFoundError("Reserva");
  }

  if (input.quantity.greaterThan(reservation.quantity)) {
    throw new BusinessRuleError("A entrega não pode ser maior que o reservado.");
  }

  await lockStockLevelById(tx, reservation.stockLevelId);

  await tx.stockReservation.update({
    where: { id: reservation.id },
    data: {
      status: input.quantity.greaterThanOrEqualTo(reservation.quantity) ? "CONSUMED" : "ACTIVE",
      quantity: reservation.quantity.minus(input.quantity),
    },
  });
}

/** Reserva ativa de uma linha de solicitação, para a tela de entrega. */
export async function getActiveReservation(
  client: Prisma.TransactionClient,
  requestLineId: string,
) {
  return client.stockReservation.findUnique({
    where: { requestLineId },
    select: {
      id: true,
      quantity: true,
      status: true,
      stockLevel: {
        select: {
          id: true,
          quantity: true,
          reservedQuantity: true,
          storageLocation: { select: { id: true, code: true, name: true } },
        },
      },
    },
  });
}
