import { Prisma } from "@/generated/prisma/client";
import type { TransferStatus } from "@/generated/prisma/enums";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/server/services/audit";
import { notify } from "@/server/services/notification";
import { postStockDocument } from "@/server/services/stock/post-document";
import { nextTransferNumber } from "@/server/services/stock/numbering";
import { assertTransition } from "@/server/services/transfer/transitions";
import type { AuthContext } from "@/server/auth/context";
import { assertBranchAccess, visibleBranchIds } from "@/server/auth/scope";

/**
 * Serviço de transferências entre unidades.
 *
 * O material sai do saldo da origem no envio (`TRANSFER_OUT`) e entra no
 * destino no recebimento (`TRANSFER_IN`). Entre os dois, ele está "em
 * trânsito": fora das duas unidades, visível no painel da matriz.
 */

/** Local de onde o material sai/entra: o almoxarifado principal da unidade. */
async function defaultLocationId(tx: Prisma.TransactionClient, branchId: string): Promise<string> {
  const location = await tx.storageLocation.findFirst({
    where: { branchId, active: true },
    orderBy: [{ type: "asc" }, { code: "asc" }],
    select: { id: true },
  });

  if (!location) {
    throw new BusinessRuleError(
      "A unidade não tem local de estoque ativo. Cadastre o almoxarifado antes de transferir.",
    );
  }

  return location.id;
}

/** Transferências visíveis: da filial ativa (origem ou destino). */
function visibilityFilter(context: AuthContext, options?: { branchId?: string | null }) {
  const branchId = options?.branchId ?? context.activeBranchId;

  if (branchId) {
    assertBranchAccess(context, branchId);

    return { OR: [{ originBranchId: branchId }, { destinationBranchId: branchId }] };
  }

  return {
    OR: [
      { originBranchId: { in: visibleBranchIds(context) } },
      { destinationBranchId: { in: visibleBranchIds(context) } },
    ],
  };
}

export type TransferListFilters = {
  search?: string;
  status?: string | null;
  branchId?: string | null;
  direction?: "incoming" | "outgoing" | "all";
  page?: number;
  pageSize?: number;
};

export async function listTransfers(context: AuthContext, filters: TransferListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));

  const branchId = filters.branchId ?? context.activeBranchId;

  const directionFilter: Prisma.TransferWhereInput =
    filters.direction === "incoming" && branchId
      ? { destinationBranchId: branchId }
      : filters.direction === "outgoing" && branchId
        ? { originBranchId: branchId }
        : {};

  const where: Prisma.TransferWhereInput = {
    ...(filters.status ? { status: filters.status as TransferStatus } : {}),
    ...(filters.search ? { number: { contains: filters.search, mode: "insensitive" } } : {}),
    ...directionFilter,
    ...(Object.keys(directionFilter).length === 0 ? visibilityFilter(context, { branchId }) : {}),
  };

  const [transfers, total] = await Promise.all([
    prisma.transfer.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        number: true,
        status: true,
        priority: true,
        createdAt: true,
        sentAt: true,
        receivedAt: true,
        originBranch: { select: { id: true, code: true, name: true } },
        destinationBranch: { select: { id: true, code: true, name: true } },
        createdBy: { select: { name: true } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.transfer.count({ where }),
  ]);

  return {
    items: transfers,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getTransfer(context: AuthContext, transferId: string) {
  const transfer = await prisma.transfer.findFirst({
    where: {
      id: transferId,
      OR: [
        { originBranchId: { in: visibleBranchIds(context) } },
        { destinationBranchId: { in: visibleBranchIds(context) } },
      ],
    },
    select: {
      id: true,
      number: true,
      status: true,
      priority: true,
      notes: true,
      rejectionReason: true,
      createdAt: true,
      sentAt: true,
      receivedAt: true,
      originBranch: { select: { id: true, code: true, name: true } },
      destinationBranch: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      sentBy: { select: { id: true, name: true } },
      receivedBy: { select: { id: true, name: true } },
      lines: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          quantitySent: true,
          quantityReceived: true,
          notes: true,
          item: {
            select: {
              id: true,
              code: true,
              name: true,
              unit: { select: { code: true } },
              controlledByLot: true,
            },
          },
        },
      },
      events: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          fromStatus: true,
          toStatus: true,
          comment: true,
          createdAt: true,
          actor: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!transfer) throw new NotFoundError("Transferência");

  return transfer;
}

export type CreateTransferInput = {
  originBranchId: string;
  destinationBranchId: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  notes?: string;
  lines: Array<{ itemId: string; quantity: string; notes?: string }>;
};

export async function createTransfer(
  context: AuthContext,
  input: CreateTransferInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  assertBranchAccess(context, input.originBranchId);

  if (input.originBranchId === input.destinationBranchId) {
    throw new BusinessRuleError("A unidade de origem e a de destino precisam ser diferentes.");
  }

  const destination = await prisma.branch.findFirst({
    where: { id: input.destinationBranchId, active: true },
    select: { id: true },
  });

  if (!destination) {
    throw new BusinessRuleError("A unidade de destino está inativa ou não existe.");
  }

  if (input.lines.length === 0) {
    throw new BusinessRuleError("Adicione ao menos um material para transferir.");
  }

  return prisma.$transaction(async (tx) => {
    const number = await nextTransferNumber(tx, input.originBranchId);

    const transfer = await tx.transfer.create({
      data: {
        number,
        originBranchId: input.originBranchId,
        destinationBranchId: input.destinationBranchId,
        priority: input.priority,
        notes: input.notes,
        createdById: context.user.id,
        requestedById: context.user.id,
        status: "DRAFT",
        lines: {
          create: input.lines.map((line) => ({
            itemId: line.itemId,
            quantitySent: new Prisma.Decimal(line.quantity),
            notes: line.notes,
          })),
        },
      },
      select: { id: true, number: true },
    });

    await tx.transferEvent.create({
      data: {
        transferId: transfer.id,
        actorId: context.user.id,
        type: "CREATED",
        toStatus: "DRAFT",
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "transfer.created",
        entityType: "Transfer",
        entityId: transfer.id,
        branchId: input.originBranchId,
        after: {
          number,
          destinationBranchId: input.destinationBranchId,
          lines: input.lines.length,
        },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return transfer;
  });
}

/**
 * Envia a transferência: baixa o saldo da origem.
 *
 * A partir daqui o material está em trânsito — não pertence a nenhuma unidade
 * até o recebimento.
 */
export async function sendTransfer(
  context: AuthContext,
  transferId: string,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(
    async (tx) => {
      const transfer = await tx.transfer.findUnique({
        where: { id: transferId },
        select: {
          id: true,
          number: true,
          status: true,
          originBranchId: true,
          destinationBranchId: true,
          notes: true,
          lines: {
            select: { itemId: true, quantitySent: true },
          },
        },
      });

      if (!transfer) throw new NotFoundError("Transferência");

      assertBranchAccess(context, transfer.originBranchId);
      assertTransition(transfer.status, "SENT");

      if (transfer.lines.length === 0) {
        throw new BusinessRuleError("A transferência não tem itens.");
      }

      const locationId = await defaultLocationId(tx, transfer.originBranchId);

      // Baixa na origem. Se não houver saldo, o motor de estoque lança
      // InsufficientStockError e nada é persistido — a transferência continua
      // em rascunho para o usuário ajustar.
      const document = await postStockDocument(tx, {
        type: "TRANSFER_OUT",
        branchId: transfer.originBranchId,
        storageLocationId: locationId,
        notes: `Transferência ${transfer.number} para ${transfer.destinationBranchId}`,
        referenceType: "TRANSFER",
        referenceId: transfer.id,
        createdById: context.user.id,
        lines: transfer.lines.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantitySent.negated(),
        })),
      });

      await tx.transfer.update({
        where: { id: transfer.id },
        data: {
          status: "SENT",
          sentById: context.user.id,
          sentAt: new Date(),
        },
      });

      await tx.transferEvent.create({
        data: {
          transferId: transfer.id,
          actorId: context.user.id,
          type: "SENT",
          fromStatus: transfer.status,
          toStatus: "SENT",
          metadata: { stockDocumentNumber: document.number },
        },
      });

      await writeAuditLog(
        {
          actorId: context.user.id,
          action: "transfer.sent",
          entityType: "Transfer",
          entityId: transfer.id,
          branchId: transfer.originBranchId,
          after: { status: "SENT", stockDocumentNumber: document.number },
          ip: metadata?.ip,
          userAgent: metadata?.userAgent,
        },
        tx,
      );

      await notify(tx, {
        type: "TRANSFER_SENT",
        actorId: context.user.id,
        branchId: transfer.destinationBranchId,
        entityType: "Transfer",
        entityId: transfer.id,
        data: {
          transferId: transfer.id,
          number: transfer.number,
          originBranchId: transfer.originBranchId,
        },
      });

      return { documentNumber: document.number };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

/** Confirma a saída física. Opcional, mas alimenta o painel de trânsito. */
export async function dispatchTransfer(
  context: AuthContext,
  transferId: string,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.transfer.findUnique({
      where: { id: transferId },
      select: { id: true, status: true, originBranchId: true },
    });

    if (!transfer) throw new NotFoundError("Transferência");

    assertBranchAccess(context, transfer.originBranchId);
    assertTransition(transfer.status, "IN_TRANSIT");

    await tx.transfer.update({ where: { id: transferId }, data: { status: "IN_TRANSIT" } });

    await tx.transferEvent.create({
      data: {
        transferId,
        actorId: context.user.id,
        type: "SENT",
        fromStatus: transfer.status,
        toStatus: "IN_TRANSIT",
        comment: "Material despachado",
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "transfer.dispatched",
        entityType: "Transfer",
        entityId: transferId,
        branchId: transfer.originBranchId,
        after: { status: "IN_TRANSIT" },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}

export type ReceiveTransferInput = {
  transferId: string;
  lines: Array<{ lineId: string; quantityReceived: string; notes?: string }>;
  comment?: string;
};

/**
 * Recebe a transferência no destino.
 *
 * Aceita recebimento **parcial**: o que chegou entra no estoque do destino e o
 * que faltou continua em trânsito, podendo ser devolvido.
 */
export async function receiveTransfer(
  context: AuthContext,
  input: ReceiveTransferInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(
    async (tx) => {
      const transfer = await tx.transfer.findUnique({
        where: { id: input.transferId },
        select: {
          id: true,
          number: true,
          status: true,
          originBranchId: true,
          destinationBranchId: true,
          lines: {
            select: { id: true, itemId: true, quantitySent: true, quantityReceived: true },
          },
        },
      });

      if (!transfer) throw new NotFoundError("Transferência");

      assertBranchAccess(context, transfer.destinationBranchId);

      if (transfer.status !== "IN_TRANSIT" && transfer.status !== "SENT") {
        throw new BusinessRuleError("Só é possível receber transferência enviada ou em trânsito.");
      }

      const locationId = await defaultLocationId(tx, transfer.destinationBranchId);
      const lineById = new Map(transfer.lines.map((line) => [line.id, line]));

      const receipts = input.lines
        .map((received) => {
          const line = lineById.get(received.lineId);
          if (!line) return null;

          return {
            line,
            quantity: new Prisma.Decimal(received.quantityReceived),
            notes: received.notes,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      if (receipts.length === 0) {
        throw new BusinessRuleError("Informe a quantidade recebida de pelo menos um item.");
      }

      for (const receipt of receipts) {
        const pending = receipt.line.quantitySent.minus(receipt.line.quantityReceived);

        if (receipt.quantity.isNegative()) {
          throw new BusinessRuleError("Quantidade recebida não pode ser negativa.");
        }

        if (receipt.quantity.greaterThan(pending)) {
          throw new BusinessRuleError(
            "Quantidade recebida maior que o pendente. Confira a contagem antes de confirmar.",
          );
        }
      }

      const toReceive = receipts.filter((receipt) => receipt.quantity.greaterThan(0));

      if (toReceive.length > 0) {
        await postStockDocument(tx, {
          type: "TRANSFER_IN",
          branchId: transfer.destinationBranchId,
          storageLocationId: locationId,
          notes: `Recebimento da transferência ${transfer.number}`,
          referenceType: "TRANSFER",
          referenceId: transfer.id,
          createdById: context.user.id,
          lines: toReceive.map((receipt) => ({
            itemId: receipt.line.itemId,
            quantity: receipt.quantity,
          })),
        });
      }

      for (const receipt of receipts) {
        await tx.transferLine.update({
          where: { id: receipt.line.id },
          data: {
            quantityReceived: receipt.line.quantityReceived.plus(receipt.quantity),
            ...(receipt.notes ? { notes: receipt.notes } : {}),
          },
        });
      }

      // Estado final depende do que ainda falta chegar.
      const updatedLines = await tx.transferLine.findMany({
        where: { transferId: transfer.id },
        select: { quantitySent: true, quantityReceived: true },
      });

      const fullyReceived = updatedLines.every((line) =>
        line.quantityReceived.greaterThanOrEqualTo(line.quantitySent),
      );

      const nextStatus: TransferStatus = fullyReceived ? "RECEIVED" : "IN_TRANSIT";

      await tx.transfer.update({
        where: { id: transfer.id },
        data: {
          status: nextStatus,
          receivedById: context.user.id,
          receivedAt: fullyReceived ? new Date() : null,
        },
      });

      await tx.transferEvent.create({
        data: {
          transferId: transfer.id,
          actorId: context.user.id,
          type: fullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED",
          fromStatus: transfer.status,
          toStatus: nextStatus,
          comment: input.comment,
        },
      });

      await writeAuditLog(
        {
          actorId: context.user.id,
          action: fullyReceived ? "transfer.received" : "transfer.partially_received",
          entityType: "Transfer",
          entityId: transfer.id,
          branchId: transfer.destinationBranchId,
          after: { status: nextStatus, linesReceived: toReceive.length },
          ip: metadata?.ip,
          userAgent: metadata?.userAgent,
        },
        tx,
      );

      await notify(tx, {
        type: "TRANSFER_RECEIVED",
        actorId: context.user.id,
        branchId: transfer.originBranchId,
        entityType: "Transfer",
        entityId: transfer.id,
        data: {
          transferId: transfer.id,
          number: transfer.number,
          destinationBranchId: transfer.destinationBranchId,
        },
      });

      return { status: nextStatus, fullyReceived };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

/**
 * Devolve o que não chegou ao destino.
 *
 * O material em trânsito volta para o saldo da origem. Só o que ainda não foi
 * recebido pode ser devolvido.
 */
export async function returnTransfer(
  context: AuthContext,
  input: { transferId: string; reason: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(
    async (tx) => {
      const transfer = await tx.transfer.findUnique({
        where: { id: input.transferId },
        select: {
          id: true,
          number: true,
          status: true,
          originBranchId: true,
          destinationBranchId: true,
          lines: {
            select: { itemId: true, quantitySent: true, quantityReceived: true },
          },
        },
      });

      if (!transfer) throw new NotFoundError("Transferência");

      assertTransition(transfer.status, "RETURNED");

      // Quem devolve é o destino; a matriz também pode agir em nome dele.
      if (!context.branchIds.includes(transfer.destinationBranchId)) {
        assertBranchAccess(context, transfer.originBranchId);
      }

      const pending = transfer.lines
        .map((line) => ({
          itemId: line.itemId,
          quantity: line.quantitySent.minus(line.quantityReceived),
        }))
        .filter((line) => line.quantity.greaterThan(0));

      if (pending.length === 0) {
        throw new BusinessRuleError("Não há nada pendente para devolver nesta transferência.");
      }

      const locationId = await defaultLocationId(tx, transfer.originBranchId);

      const document = await postStockDocument(tx, {
        type: "RETURN",
        branchId: transfer.originBranchId,
        storageLocationId: locationId,
        notes: `Devolução da transferência ${transfer.number}: ${input.reason}`,
        referenceType: "TRANSFER",
        referenceId: transfer.id,
        createdById: context.user.id,
        lines: pending.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity,
        })),
      });

      await tx.transfer.update({
        where: { id: transfer.id },
        data: { status: "RETURNED", rejectionReason: input.reason },
      });

      await tx.transferEvent.create({
        data: {
          transferId: transfer.id,
          actorId: context.user.id,
          type: "RETURNED",
          fromStatus: transfer.status,
          toStatus: "RETURNED",
          comment: input.reason,
          metadata: { stockDocumentNumber: document.number },
        },
      });

      await writeAuditLog(
        {
          actorId: context.user.id,
          action: "transfer.returned",
          entityType: "Transfer",
          entityId: transfer.id,
          branchId: transfer.originBranchId,
          after: { status: "RETURNED", reason: input.reason, documentNumber: document.number },
          ip: metadata?.ip,
          userAgent: metadata?.userAgent,
        },
        tx,
      );

      return { documentNumber: document.number };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

/** Cancela. Se já houve baixa na origem, o saldo é estornado. */
export async function cancelTransfer(
  context: AuthContext,
  input: { transferId: string; reason: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.transfer.findUnique({
      where: { id: input.transferId },
      select: {
        id: true,
        number: true,
        status: true,
        originBranchId: true,
        destinationBranchId: true,
        lines: { select: { quantityReceived: true } },
      },
    });

    if (!transfer) throw new NotFoundError("Transferência");

    assertBranchAccess(context, transfer.originBranchId);
    assertTransition(transfer.status, "CANCELLED");

    const alreadyReceived = transfer.lines.some((line) => line.quantityReceived.greaterThan(0));

    if (alreadyReceived) {
      throw new BusinessRuleError(
        "Esta transferência já teve recebimento. Use a devolução em vez de cancelar.",
      );
    }

    // Em SENT a mercadoria já saiu do estoque da origem: cancelar precisa
    // devolver o saldo, e a única forma auditável é a devolução.
    if (transfer.status === "SENT") {
      const locationId = await defaultLocationId(tx, transfer.originBranchId);

      const lines = await tx.transferLine.findMany({
        where: { transferId: transfer.id },
        select: { itemId: true, quantitySent: true },
      });

      const document = await postStockDocument(tx, {
        type: "RETURN",
        branchId: transfer.originBranchId,
        storageLocationId: locationId,
        notes: `Cancelamento da transferência ${transfer.number}: ${input.reason}`,
        referenceType: "TRANSFER",
        referenceId: transfer.id,
        createdById: context.user.id,
        lines: lines.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantitySent,
        })),
      });

      await tx.transferEvent.create({
        data: {
          transferId: transfer.id,
          actorId: context.user.id,
          type: "CANCELLED",
          fromStatus: transfer.status,
          toStatus: "CANCELLED",
          comment: input.reason,
          metadata: { stockDocumentNumber: document.number },
        },
      });
    } else {
      await tx.transferEvent.create({
        data: {
          transferId: transfer.id,
          actorId: context.user.id,
          type: "CANCELLED",
          fromStatus: transfer.status,
          toStatus: "CANCELLED",
          comment: input.reason,
        },
      });
    }

    await tx.transfer.update({
      where: { id: transfer.id },
      data: { status: "CANCELLED", rejectionReason: input.reason },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "transfer.cancelled",
        entityType: "Transfer",
        entityId: transfer.id,
        branchId: transfer.originBranchId,
        before: { status: transfer.status },
        after: { status: "CANCELLED", reason: input.reason },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}

/** Transferências a caminho da filial ativa — usado no painel e no menu. */
export async function countIncomingTransfers(branchId: string): Promise<number> {
  return prisma.transfer.count({
    where: { destinationBranchId: branchId, status: { in: ["SENT", "IN_TRANSIT"] } },
  });
}

/** Transferências em trânsito na rede — indicador do dashboard da matriz. */
export async function countInTransit(branchIds?: readonly string[]): Promise<number> {
  return prisma.transfer.count({
    where: {
      status: { in: ["SENT", "IN_TRANSIT"] },
      ...(branchIds && branchIds.length > 0
        ? {
            OR: [
              { originBranchId: { in: [...branchIds] } },
              { destinationBranchId: { in: [...branchIds] } },
            ],
          }
        : {}),
    },
  });
}
