import { Prisma } from "@/generated/prisma/client";
import type { StockDocumentType } from "@/generated/prisma/enums";
import { BusinessRuleError, InsufficientStockError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { formatQuantity } from "@/lib/format";
import { prisma } from "@/lib/db";
import {
  availableQuantity,
  computeAverageCost,
  computeLineTotal,
  sumQuantities,
  sumTotals,
} from "@/server/services/stock/average-cost";
import { lockStockLevels, type StockLevelKey } from "@/server/services/stock/lock";
import { nextStockDocumentNumber } from "@/server/services/stock/numbering";
import { writeAuditLog } from "@/server/services/audit";
import { notify } from "@/server/services/notification";
import { createAssetsFromStockLines } from "@/server/services/patrimonio";

const log = logger.with({ service: "stock" });

/**
 * Motor de movimentação de estoque.
 *
 * Regras invioláveis (AGENTS.md §3.3):
 *   1. `StockDocument` + `StockLine` são a verdade e são **append-only**.
 *   2. `StockLevel` é cache materializado, atualizado sempre sob lock.
 *   3. Saldo negativo é proibido.
 *   4. Tudo acontece dentro de UMA transação.
 *   5. Toda linha de estoque nasce de um documento.
 *
 * `quantity` é **assinada**: positiva em entrada, negativa em saída. O sinal é
 * o que define o efeito no saldo, não o tipo do documento — isso evita duas
 * fontes de verdade.
 */

export type StockLineInput = {
  itemId: string;
  itemLotId?: string | null;
  /** Assinada: positiva entra, negativa sai. */
  quantity: Prisma.Decimal;
  unitCost?: Prisma.Decimal;
  /**
   * Quantidade de reserva a liberar nesta linha (usado na entrega de
   * solicitação: a reserva vira saída real).
   */
  releaseReserved?: Prisma.Decimal;
  /**
   * Séries informadas na entrada de material com série (FASE 23): o patrimônio
   * nasce daqui, um bem por série.
   */
  serialNumbers?: readonly string[];
};

export type PostDocumentInput = {
  type: StockDocumentType;
  branchId: string;
  storageLocationId: string;
  destinationLocationId?: string | null;
  date?: Date;
  notes?: string;
  referenceType?: string;
  referenceId?: string;
  createdById: string;
  lines: readonly StockLineInput[];
};

export type PostDocumentResult = {
  documentId: string;
  number: string;
  totalQuantity: Prisma.Decimal;
  totalCost: Prisma.Decimal;
};

function isOutbound(quantity: Prisma.Decimal): boolean {
  return quantity.isNegative();
}

/**
 * Valida se uma linha pode ser lançada, sem persistir nada.
 *
 * Usado também pela interface para mostrar o impacto antes de confirmar.
 */
export async function previewStockImpact(
  client: Prisma.TransactionClient | typeof prisma,
  storageLocationId: string,
  lines: readonly StockLineInput[],
): Promise<
  Array<{
    itemId: string;
    itemName: string;
    unitCode: string;
    currentQuantity: string;
    currentReserved: string;
    available: string;
    change: string;
    resultingQuantity: string;
    insufficient: boolean;
  }>
> {
  const itemIds = [...new Set(lines.map((line) => line.itemId))];

  const items = await client.item.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true, unit: { select: { code: true } } },
  });

  const itemById = new Map(items.map((item) => [item.id, item]));

  const levels = await client.stockLevel.findMany({
    where: { itemId: { in: itemIds } },
    select: {
      itemId: true,
      storageLocationId: true,
      quantity: true,
      reservedQuantity: true,
    },
  });

  const levelByKey = new Map(
    levels.map((level) => [`${level.itemId}:${level.storageLocationId}`, level]),
  );

  return lines.map((line) => {
    const item = itemById.get(line.itemId);
    const level = levelByKey.get(`${line.itemId}:${storageLocationId}`);

    const currentQuantity = level?.quantity ?? new Prisma.Decimal(0);
    const currentReserved = level?.reservedQuantity ?? new Prisma.Decimal(0);
    const available = currentQuantity.minus(currentReserved);
    const resulting = currentQuantity.plus(line.quantity);

    return {
      itemId: line.itemId,
      itemName: item?.name ?? "Material não encontrado",
      unitCode: item?.unit.code ?? "",
      currentQuantity: currentQuantity.toString(),
      currentReserved: currentReserved.toString(),
      available: available.toString(),
      change: line.quantity.toString(),
      resultingQuantity: resulting.toString(),
      insufficient: isOutbound(line.quantity) && resulting.lessThan(0),
    };
  });
}

/**
 * Lança um documento de estoque.
 *
 * Recebe um `tx` para poder ser composto por transferência, entrega de
 * solicitação e inventário — todas precisam que a movimentação e o evento de
 * negócio sejam atômicos.
 */
export async function postStockDocument(
  tx: Prisma.TransactionClient,
  input: PostDocumentInput,
): Promise<PostDocumentResult> {
  if (input.lines.length === 0) {
    throw new BusinessRuleError("A movimentação precisa ter ao menos um item.");
  }

  for (const line of input.lines) {
    if (line.quantity.isZero()) {
      throw new BusinessRuleError(
        "Quantidade não pode ser zero. Remova a linha ou informe uma quantidade.",
      );
    }
  }

  // Uma linha duplicada do mesmo item no mesmo documento é ambígua para o
  // lock e para o custo médio — melhor recusar do que adivinhar.
  const seen = new Set<string>();
  for (const line of input.lines) {
    if (seen.has(line.itemId)) {
      throw new BusinessRuleError(
        "Há o mesmo material repetido no documento. Agrupe as quantidades em uma linha.",
      );
    }
    seen.add(line.itemId);
  }

  const itemIds = input.lines.map((line) => line.itemId);

  const items = await tx.item.findMany({
    where: { id: { in: itemIds } },
    select: {
      id: true,
      name: true,
      active: true,
      controlledByLot: true,
      perishable: true,
      unit: { select: { code: true, allowsDecimals: true } },
    },
  });

  const itemById = new Map(items.map((item) => [item.id, item]));

  for (const line of input.lines) {
    const item = itemById.get(line.itemId);

    if (!item) throw new NotFoundError("Material");

    if (!item.active) {
      throw new BusinessRuleError(
        `O material ${item.name} está desativado e não pode ser movimentado.`,
      );
    }

    // Lote é obrigatório e precisa estar válido para material controlado.
    if (item.controlledByLot) {
      if (!line.itemLotId) {
        throw new BusinessRuleError(
          `O material ${item.name} é controlado por lote. Informe o lote.`,
        );
      }

      const lot = await tx.itemLot.findUnique({
        where: { id: line.itemLotId },
        select: { id: true, code: true, expirationDate: true, active: true, itemId: true },
      });

      if (!lot || lot.itemId !== line.itemId) {
        throw new BusinessRuleError(`Lote inválido para o material ${item.name}.`);
      }

      if (!lot.active) {
        throw new BusinessRuleError(`O lote ${lot.code} de ${item.name} está desativado.`);
      }

      if (item.perishable && lot.expirationDate && lot.expirationDate < new Date()) {
        throw new BusinessRuleError(
          `O lote ${lot.code} de ${item.name} está vencido (${lot.expirationDate.toLocaleDateString("pt-BR")}).`,
        );
      }
    } else if (line.itemLotId) {
      throw new BusinessRuleError(
        `O material ${item.name} não é controlado por lote. Remova o lote da linha.`,
      );
    }

    // Quantidade fracionada só é permitida para unidades que aceitam decimal.
    if (!item.unit.allowsDecimals && !line.quantity.isInteger()) {
      throw new BusinessRuleError(
        `O material ${item.name} é contado em ${item.unit.code} e não aceita quantidade fracionada.`,
      );
    }
  }

  // Trava os saldos afetados (ordem determinística, sem deadlock).
  const keys: StockLevelKey[] = input.lines.map((line) => ({
    itemId: line.itemId,
    storageLocationId: input.storageLocationId,
    branchId: input.branchId,
  }));

  const levels = await lockStockLevels(tx, keys);

  const prepared = input.lines.map((line) => {
    const item = itemById.get(line.itemId);
    const key = `${line.itemId}:${input.storageLocationId}`;
    const level = levels.get(key);

    if (!level) {
      throw new NotFoundError("Saldo de estoque");
    }

    const available = level.quantity.minus(level.reservedQuantity);

    // Reserva liberada nesta linha (entrega de solicitação) volta a ficar
    // disponível: é a diferença entre "reservado para outra pessoa" e
    // "reservado para este documento".
    const reservedAfterRelease =
      line.releaseReserved !== undefined
        ? Prisma.Decimal.max(level.reservedQuantity.minus(line.releaseReserved), 0)
        : level.reservedQuantity;

    const effectiveAvailable = level.quantity.minus(reservedAfterRelease);

    if (isOutbound(line.quantity)) {
      // Saída não pode consumir o que está reservado para outra solicitação,
      // nem deixar o saldo negativo.
      if (line.quantity.abs().greaterThan(effectiveAvailable)) {
        throw new InsufficientStockError(
          item?.name ?? "material",
          formatQuantity(line.quantity.abs()),
          formatQuantity(Prisma.Decimal.max(effectiveAvailable, 0)),
        );
      }
    }

    if (level.quantity.plus(line.quantity).lessThan(0)) {
      throw new InsufficientStockError(
        item?.name ?? "material",
        formatQuantity(line.quantity.abs()),
        formatQuantity(available),
      );
    }

    const unitCost = line.unitCost ?? level.averageCost;

    const nextQuantity = level.quantity.plus(line.quantity);
    const nextReserved =
      line.releaseReserved !== undefined
        ? Prisma.Decimal.max(level.reservedQuantity.minus(line.releaseReserved), 0)
        : level.reservedQuantity;

    const nextAverageCost = isOutbound(line.quantity)
      ? level.averageCost
      : computeAverageCost({
          currentQuantity: level.quantity,
          currentAverageCost: level.averageCost,
          incomingQuantity: line.quantity,
          incomingUnitCost: unitCost,
        });

    return {
      line,
      item,
      level,
      unitCost,
      nextQuantity,
      nextReserved,
      nextAverageCost,
      lineTotal: computeLineTotal(line.quantity, unitCost),
    };
  });

  // Atualiza os saldos (cache) — version incrementada para lock otimista.
  for (const entry of prepared) {
    await tx.stockLevel.update({
      where: { id: entry.level.id },
      data: {
        quantity: entry.nextQuantity,
        reservedQuantity: entry.nextReserved,
        averageCost: entry.nextAverageCost,
        version: { increment: 1 },
        lastMovementAt: new Date(),
      },
    });
  }

  const date = input.date ?? new Date();
  const number = await nextStockDocumentNumber(tx, input.branchId, date);

  const totalQuantity = sumQuantities(prepared.map((entry) => entry.line.quantity));
  const totalCost = sumTotals(prepared.map((entry) => entry.lineTotal));

  const document = await tx.stockDocument.create({
    data: {
      number,
      type: input.type,
      status: "POSTED",
      branchId: input.branchId,
      storageLocationId: input.storageLocationId,
      destinationLocationId: input.destinationLocationId ?? null,
      date,
      notes: input.notes,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      totalQuantity,
      totalCost,
      postedAt: new Date(),
      createdById: input.createdById,
    },
    select: { id: true, number: true },
  });

  // Linhas são append-only: nunca recebem update nem delete.
  await tx.stockLine.createMany({
    data: prepared.map((entry) => ({
      stockDocumentId: document.id,
      itemId: entry.line.itemId,
      itemLotId: entry.line.itemLotId ?? null,
      serialNumbers: entry.line.serialNumbers ? [...entry.line.serialNumbers] : [],
      quantity: entry.line.quantity,
      unitCost: entry.unitCost,
      lineTotal: entry.lineTotal,
    })),
  });

  // Material com número de série e marcado como patrimônio gera os bens na
  // **mesma transação** do documento: ou entra o estoque e nasce o bem, ou nada.
  await createAssetsFromStockLines(tx, {
    branchId: input.branchId,
    storageLocationId: input.storageLocationId,
    actorId: input.createdById,
    type: input.type,
    lines: prepared.map((entry) => ({
      itemId: entry.line.itemId,
      quantity: entry.line.quantity,
      serialNumbers: entry.line.serialNumbers,
    })),
  });

  // Material que saiu pode ter cruzado o mínimo: avisa quem repõe.
  const outboundItems = prepared
    .filter((entry) => isOutbound(entry.line.quantity))
    .map((entry) => entry.line.itemId);

  if (outboundItems.length > 0) {
    await notifyBelowMinimum(tx, {
      branchId: input.branchId,
      itemIds: outboundItems,
      actorId: input.createdById,
    });
  }

  log.info("documento de estoque lançado", {
    documentId: document.id,
    number,
    type: input.type,
    branchId: input.branchId,
    lines: prepared.length,
    totalQuantity: totalQuantity.toString(),
    totalCost: totalCost.toString(),
  });

  return { documentId: document.id, number, totalQuantity, totalCost };
}

/**
 * Avisa quando um material cruza o mínimo da unidade.
 *
 * A verificação roda dentro da transação do documento e é **deduplicada por
 * 7 dias**: sem isso, cada saída de um item já em falta geraria uma
 * notificação nova e o alerta viraria ruído.
 */
async function notifyBelowMinimum(
  tx: Prisma.TransactionClient,
  input: { branchId: string; itemIds: readonly string[]; actorId: string },
): Promise<void> {
  const policies = await tx.itemStockPolicy.findMany({
    where: {
      branchId: input.branchId,
      itemId: { in: [...input.itemIds] },
      minimumQuantity: { gt: 0 },
      item: { active: true },
    },
    select: {
      minimumQuantity: true,
      item: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } },
    },
  });

  if (policies.length === 0) return;

  const levels = await tx.stockLevel.findMany({
    where: { branchId: input.branchId, itemId: { in: policies.map((p) => p.item.id) } },
    select: { itemId: true, quantity: true, reservedQuantity: true },
  });

  const availableByItem = new Map<string, Prisma.Decimal>();

  for (const level of levels) {
    const current = availableByItem.get(level.itemId) ?? new Prisma.Decimal(0);

    availableByItem.set(
      level.itemId,
      current.plus(availableQuantity(level.quantity, level.reservedQuantity)),
    );
  }

  for (const policy of policies) {
    const available = availableByItem.get(policy.item.id) ?? new Prisma.Decimal(0);

    if (available.greaterThanOrEqualTo(policy.minimumQuantity)) continue;

    await notify(
      tx,
      {
        type: "STOCK_BELOW_MIN",
        actorId: input.actorId,
        branchId: input.branchId,
        entityType: "Item",
        entityId: policy.item.id,
        data: {
          itemId: policy.item.id,
          itemCode: policy.item.code,
          itemName: policy.item.name,
          unitCode: policy.item.unit.code,
          available: available.toString(),
          minimum: policy.minimumQuantity.toString(),
        },
      },
      { dedupe: true },
    );
  }
}

/**
 * Lança um documento abrindo a própria transação.
 * Use quando a movimentação **não** faz parte de um evento maior.
 */
export async function createAndPostStockDocument(
  input: PostDocumentInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
): Promise<PostDocumentResult> {
  return prisma.$transaction(
    async (tx) => {
      const result = await postStockDocument(tx, input);

      await writeAuditLog(
        {
          actorId: input.createdById,
          action: "stock_document.posted",
          entityType: "StockDocument",
          entityId: result.documentId,
          branchId: input.branchId,
          after: {
            number: result.number,
            type: input.type,
            totalQuantity: result.totalQuantity.toString(),
            totalCost: result.totalCost.toString(),
            lines: input.lines.length,
          },
          ip: metadata?.ip,
          userAgent: metadata?.userAgent,
        },
        tx,
      );

      return result;
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

/**
 * Cancela um documento lançado gerando o **inverso**.
 *
 * Nunca apagamos: a trilha de auditoria do almoxarifado precisa mostrar que
 * houve lançamento e estorno.
 */
export async function cancelStockDocument(
  input: {
    documentId: string;
    createdById: string;
    reason: string;
  },
  metadata?: { ip?: string | null; userAgent?: string | null },
): Promise<PostDocumentResult> {
  return prisma.$transaction(
    async (tx) => {
      const original = await tx.stockDocument.findUnique({
        where: { id: input.documentId },
        select: {
          id: true,
          number: true,
          type: true,
          status: true,
          branchId: true,
          storageLocationId: true,
          destinationLocationId: true,
          referenceType: true,
          referenceId: true,
          notes: true,
          lines: {
            select: {
              itemId: true,
              itemLotId: true,
              quantity: true,
              unitCost: true,
            },
          },
        },
      });

      if (!original) throw new NotFoundError("Movimentação");

      if (original.status !== "POSTED") {
        throw new BusinessRuleError("Somente movimentações lançadas podem ser canceladas.");
      }

      // Documento gerado por um fluxo de negócio não pode ser cancelado por
      // fora: o estorno precisa reconciliar a solicitação/transferência/
      // inventário de origem, senão o saldo volta e a entidade fica inconsistente.
      if (
        original.referenceType === "REQUEST" ||
        original.referenceType === "TRANSFER" ||
        original.referenceType === "INVENTORY"
      ) {
        throw new BusinessRuleError(
          "Esta movimentação foi gerada por uma solicitação, transferência ou inventário. " +
            "Cancele pelo fluxo de origem — o estoque é estornado lá.",
        );
      }

      // Cancela invertendo os sinais das linhas.
      const reversal = await postStockDocument(tx, {
        type: original.type,
        branchId: original.branchId,
        storageLocationId: original.storageLocationId,
        destinationLocationId: original.destinationLocationId,
        notes: `Estorno de ${original.number}: ${input.reason}`,
        referenceType: "CANCELLED_DOCUMENT",
        referenceId: original.id,
        createdById: input.createdById,
        lines: original.lines.map((line) => ({
          itemId: line.itemId,
          itemLotId: line.itemLotId,
          quantity: line.quantity.negated(),
          unitCost: line.unitCost,
        })),
      });

      await tx.stockDocument.update({
        where: { id: original.id },
        data: { status: "CANCELLED", reversalDocumentId: reversal.documentId },
      });

      await tx.stockDocument.update({
        where: { id: reversal.documentId },
        data: { notes: `Estorno de ${original.number}: ${input.reason}` },
      });

      await writeAuditLog(
        {
          actorId: input.createdById,
          action: "stock_document.cancelled",
          entityType: "StockDocument",
          entityId: original.id,
          branchId: original.branchId,
          before: { status: "POSTED" },
          after: { status: "CANCELLED", reversalNumber: reversal.number, reason: input.reason },
          ip: metadata?.ip,
          userAgent: metadata?.userAgent,
        },
        tx,
      );

      return reversal;
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}
