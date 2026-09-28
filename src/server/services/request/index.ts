import { Prisma } from "@/generated/prisma/client";
import type { RequestStatus } from "@/generated/prisma/enums";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { computeLineTotal, availableQuantity } from "@/server/services/stock/average-cost";
import { nextRequestNumber } from "@/server/services/stock/numbering";
import { postStockDocument } from "@/server/services/stock/post-document";
import {
  consumeReservation,
  releaseReservation,
  reserveStock,
} from "@/server/services/stock/reservation";
import { writeAuditLog } from "@/server/services/audit";
import { createAttachmentRows, type AttachmentInput } from "@/server/services/attachment";
import { notify } from "@/server/services/notification";
import { getAlmoxarifadoSectorId } from "@/server/services/sector";
import {
  AWAITING_DELIVERY_STATUSES,
  PENDING_APPROVAL_STATUSES,
  assertTransition,
} from "@/server/services/request/transitions";
import type { AuthContext } from "@/server/auth/context";
import { assertBranchAccess, visibleBranchIds } from "@/server/auth/scope";

const log = logger.with({ service: "request" });

/**
 * Serviço de solicitações de material.
 *
 * O ciclo: solicitante pede → aprovador da unidade decide → almoxarife separa
 * e entrega. Aprovar **reserva** o saldo; entregar **baixa** o estoque.
 */

/* -------------------------------------------------------------------------- */
/* Disponibilidade                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Classifica cada linha segundo o saldo da unidade solicitante.
 *
 * Não bloqueia o pedido: o solicitante pode pedir algo que está em falta e o
 * aprovador decide (aprovar parcial ou pedir transferência). Isso é
 * proposital — bloquear aqui esconderia a demanda real da rede.
 */
export async function classifyAvailability(
  tx: Prisma.TransactionClient,
  branchId: string,
  lines: readonly { itemId: string; quantity: Prisma.Decimal }[],
): Promise<Map<string, "AVAILABLE" | "PARTIAL" | "UNAVAILABLE">> {
  const itemIds = lines.map((line) => line.itemId);

  const levels = await tx.stockLevel.findMany({
    where: { branchId, itemId: { in: itemIds } },
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

  const result = new Map<string, "AVAILABLE" | "PARTIAL" | "UNAVAILABLE">();

  for (const line of lines) {
    const available = availableByItem.get(line.itemId) ?? new Prisma.Decimal(0);

    if (available.greaterThanOrEqualTo(line.quantity)) {
      result.set(line.itemId, "AVAILABLE");
    } else if (available.greaterThan(0)) {
      result.set(line.itemId, "PARTIAL");
    } else {
      result.set(line.itemId, "UNAVAILABLE");
    }
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Consultas                                                                   */
/* -------------------------------------------------------------------------- */

function visibilityFilter(context: AuthContext, options?: { branchId?: string | null }) {
  const branchId = options?.branchId ?? null;

  if (branchId) {
    assertBranchAccess(context, branchId);
    return { branchId };
  }

  // Visão geral (almoxarifado e matriz): tudo do escopo de filiais.
  if (context.hasPermission("solicitacao:overview")) {
    return { branchId: { in: visibleBranchIds(context) } };
  }

  // Sem visão geral, a pessoa só enxerga o que ela mesma pediu ou o que foi
  // encaminhado ao setor dela (ex.: a TI analisando uma solicitação).
  return {
    OR: [
      { requesterId: context.user.id },
      { delegations: { some: { toSectorId: { in: context.sectorIds } } } },
    ],
  };
}

export async function getRequestDetail(context: AuthContext, requestId: string) {
  const request = await prisma.request.findFirst({
    where: { id: requestId, ...visibilityFilter(context) },
    select: {
      id: true,
      number: true,
      status: true,
      priority: true,
      approvalLevel: true,
      neededAt: true,
      notes: true,
      rejectionReason: true,
      createdAt: true,
      updatedAt: true,
      claimedAt: true,
      decidedAt: true,
      deliveredAt: true,
      branch: { select: { id: true, code: true, name: true } },
      sector: { select: { id: true, code: true, name: true } },
      serviceSector: { select: { id: true, code: true, name: true } },
      requester: { select: { id: true, name: true, email: true } },
      responsible: { select: { id: true, name: true } },
      claimedBy: { select: { id: true, name: true } },
      decidedBy: { select: { id: true, name: true } },
      attachments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          width: true,
          height: true,
          createdAt: true,
        },
      },
      lines: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          requestedQuantity: true,
          approvedQuantity: true,
          deliveredQuantity: true,
          unitPriceSnapshot: true,
          lineNotes: true,
          nonApprovalReason: true,
          availabilityStatus: true,
          item: {
            select: {
              id: true,
              code: true,
              name: true,
              controlledByLot: true,
              unit: { select: { code: true, allowsDecimals: true } },
            },
          },
          reservation: {
            select: {
              id: true,
              quantity: true,
              status: true,
              stockLevel: {
                select: {
                  storageLocation: { select: { id: true, name: true } },
                },
              },
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
      delivery: {
        select: {
          id: true,
          deliveredAt: true,
          receivedByName: true,
          receivedByDocument: true,
          notes: true,
          deliveredBy: { select: { name: true } },
          stockDocument: { select: { id: true, number: true } },
        },
      },
    },
  });

  if (!request) throw new NotFoundError("Solicitação");

  return request;
}

/** O usuário enxerga esta solicitação? Usado para liberar os anexos. */
export async function canViewRequest(context: AuthContext, requestId: string): Promise<boolean> {
  const count = await prisma.request.count({
    where: { id: requestId, ...visibilityFilter(context) },
  });

  return count > 0;
}

export type RequestListFilters = {
  search?: string;
  status?: string | null;
  priority?: string | null;
  requesterId?: string | null;
  branchId?: string | null;
  sectorId?: string | null;
  from?: string | null;
  to?: string | null;
  page?: number;
  pageSize?: number;
};

export async function listRequests(context: AuthContext, filters: RequestListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));

  const where: Prisma.RequestWhereInput = {
    ...visibilityFilter(context, { branchId: filters.branchId ?? null }),
    ...(filters.status ? { status: filters.status as RequestStatus } : {}),
    ...(filters.priority
      ? { priority: filters.priority as "LOW" | "NORMAL" | "HIGH" | "URGENT" }
      : {}),
    ...(filters.requesterId ? { requesterId: filters.requesterId } : {}),
    ...(filters.sectorId ? { sectorId: filters.sectorId } : {}),
    ...(filters.search
      ? {
          OR: [
            { number: { contains: filters.search, mode: "insensitive" } },
            { requester: { name: { contains: filters.search, mode: "insensitive" } } },
          ],
        }
      : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: new Date(filters.from) } : {}),
            ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59`) } : {}),
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.request.findMany({
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
        neededAt: true,
        branch: { select: { code: true, name: true } },
        sector: { select: { id: true, code: true, name: true } },
        requester: { select: { name: true } },
        responsible: { select: { name: true } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.request.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * Fila de aprovação da unidade: o que precisa de decisão agora.
 *
 * Ordena por prioridade e tempo de espera — urgente primeiro, e dentro disso o
 * mais antigo, para nada envelhecer esquecido.
 */
export async function listApprovalQueue(
  context: AuthContext,
  branchId: string,
  options: { page?: number; pageSize?: number } = {},
) {
  assertBranchAccess(context, branchId);

  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));

  const where: Prisma.RequestWhereInput = {
    branchId,
    status: { in: [...PENDING_APPROVAL_STATUSES] },
  };

  const priorityRank: Prisma.RequestOrderByWithRelationInput[] = [
    { priority: "desc" },
    { createdAt: "asc" },
  ];

  const [items, total] = await Promise.all([
    prisma.request.findMany({
      where,
      orderBy: priorityRank,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        number: true,
        status: true,
        priority: true,
        createdAt: true,
        neededAt: true,
        notes: true,
        requester: { select: { id: true, name: true } },
        responsible: { select: { id: true, name: true } },
        claimedBy: { select: { id: true, name: true } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.request.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Solicitações aprovadas aguardando entrega. */
export async function listPendingDeliveries(
  context: AuthContext,
  branchId: string,
  options: { page?: number; pageSize?: number } = {},
) {
  assertBranchAccess(context, branchId);

  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));

  const where: Prisma.RequestWhereInput = {
    branchId,
    status: { in: [...AWAITING_DELIVERY_STATUSES] },
  };

  const [items, total] = await Promise.all([
    prisma.request.findMany({
      where,
      orderBy: [{ decidedAt: "asc" }, { createdAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        number: true,
        status: true,
        priority: true,
        decidedAt: true,
        requester: { select: { name: true } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.request.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Minhas solicitações, para a home do usuário. */
export async function listMyRequests(
  context: AuthContext,
  options: { limit?: number; status?: string | null } = {},
) {
  return prisma.request.findMany({
    where: {
      requesterId: context.user.id,
      ...(options.status ? { status: options.status as RequestStatus } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 10,
    select: {
      id: true,
      number: true,
      status: true,
      priority: true,
      createdAt: true,
      neededAt: true,
      branch: { select: { code: true } },
      _count: { select: { lines: true } },
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Criação e edição                                                            */
/* -------------------------------------------------------------------------- */

export type RequestLineInput = {
  itemId: string;
  quantity: string;
  lineNotes?: string;
};

/**
 * Unidades que o usuário pode escolher ao abrir uma solicitação.
 *
 * Diferente do resto do sistema, aqui **qualquer unidade ativa** é aceita: o
 * colaborador pode estar temporariamente em outra unidade e precisa pedir
 * material de lá. Quem resolve o pedido é quem recebe — a unidade escolhida.
 */
export async function listRequestableBranches(context: AuthContext) {
  // Passa pelo guard para exigir sessão válida, mas não restringe ao escopo:
  // a regra de escolha é do solicitante, não do vínculo.
  void context;

  return prisma.branch.findMany({
    where: { active: true },
    orderBy: [{ type: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, type: true, city: true, state: true },
  });
}

/**
 * Abre uma solicitação.
 *
 * Nasce **já enviada para aprovação**: pedir material é um ato, não um
 * rascunho. Não existe etapa de "confirmar envio" — quem pediu, pediu.
 *
 * A prioridade **não** vem do solicitante: quem define é o responsável que
 * recebe, porque é ele quem conhece a fila e o estoque. Nasce `NORMAL`.
 */
export async function createRequest(
  context: AuthContext,
  input: {
    branchId: string;
    sectorId?: string | null;
    neededAt?: string;
    notes?: string;
    lines: RequestLineInput[];
    attachments?: AttachmentInput[];
  },
  metadata?: { ip?: string | null; userAgent?: string | null },
): Promise<{ id: string; number: string }> {
  if (input.lines.length === 0) {
    throw new BusinessRuleError("Adicione ao menos um material à solicitação.");
  }

  const branch = await prisma.branch.findFirst({
    where: { id: input.branchId, active: true },
    select: {
      id: true,
      name: true,
      defaultApproverId: true,
      notificationResponsibleId: true,
    },
  });

  if (!branch) {
    throw new BusinessRuleError("A unidade escolhida está inativa ou não existe.");
  }

  const items = await prisma.item.findMany({
    where: { id: { in: input.lines.map((line) => line.itemId) }, active: true },
    select: { id: true, referencePrice: true },
  });

  if (items.length !== input.lines.length) {
    throw new BusinessRuleError(
      "Algum material da solicitação está inativo ou não existe. Revise a lista.",
    );
  }

  const itemById = new Map(items.map((item) => [item.id, item]));

  return prisma.$transaction(
    async (tx) => {
      const number = await nextRequestNumber(tx, input.branchId);

      const availability = await classifyAvailability(
        tx,
        input.branchId,
        input.lines.map((line) => ({
          itemId: line.itemId,
          quantity: new Prisma.Decimal(line.quantity),
        })),
      );

      const responsibleId = branch.defaultApproverId ?? branch.notificationResponsibleId;

      // O setor do solicitante vem do vínculo; o setor que atende é o
      // almoxarifado por padrão (a etapa pode depois ser encaminhada à TI).
      const sectorId = input.sectorId ?? context.activeSectorId ?? null;
      const serviceSectorId = await getAlmoxarifadoSectorId(tx);

      const request = await tx.request.create({
        data: {
          number,
          branchId: input.branchId,
          requesterId: context.user.id,
          sectorId,
          serviceSectorId,
          // Já entra na fila de aprovação.
          status: "SUBMITTED",
          priority: "NORMAL",
          neededAt: input.neededAt ? new Date(input.neededAt) : null,
          notes: input.notes,
          responsibleId,
          lines: {
            create: input.lines.map((line) => ({
              itemId: line.itemId,
              requestedQuantity: new Prisma.Decimal(line.quantity),
              availabilityStatus: availability.get(line.itemId) ?? "UNAVAILABLE",
              unitPriceSnapshot: itemById.get(line.itemId)?.referencePrice ?? null,
              lineNotes: line.lineNotes,
            })),
          },
        },
        select: { id: true, number: true },
      });

      await createAttachmentRows(tx, {
        attachments: input.attachments ?? [],
        uploadedById: context.user.id,
        requestId: request.id,
      });

      await tx.requestEvent.create({
        data: {
          requestId: request.id,
          actorId: context.user.id,
          type: "SUBMITTED",
          toStatus: "SUBMITTED",
          comment: "Solicitação aberta pelo colaborador",
        },
      });

      await writeAuditLog(
        {
          actorId: context.user.id,
          action: "request.created",
          entityType: "Request",
          entityId: request.id,
          branchId: input.branchId,
          after: {
            number,
            lines: input.lines.length,
            status: "SUBMITTED",
            responsibleId,
          },
          ip: metadata?.ip,
          userAgent: metadata?.userAgent,
        },
        tx,
      );

      // Notifica quem responde **na unidade escolhida**, na mesma transação.
      await notify(tx, {
        type: "REQUEST_CREATED",
        actorId: context.user.id,
        branchId: input.branchId,
        entityType: "Request",
        entityId: request.id,
        data: {
          requestId: request.id,
          number,
          requesterName: context.user.name,
          itemCount: String(input.lines.length),
          priority: "NORMAL",
        },
      });

      log.info("solicitação aberta e enviada para aprovação", {
        requestId: request.id,
        number,
        branchId: input.branchId,
      });

      return request;
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

export async function submitRequest(
  context: AuthContext,
  requestId: string,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.request.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        number: true,
        status: true,
        branchId: true,
        requesterId: true,
        branch: { select: { defaultApproverId: true, notificationResponsibleId: true } },
        lines: { select: { itemId: true, requestedQuantity: true } },
      },
    });

    if (!request) throw new NotFoundError("Solicitação");

    assertBranchAccess(context, request.branchId);
    assertTransition(request.status, "SUBMITTED");

    if (request.requesterId !== context.user.id) {
      throw new BusinessRuleError("Somente quem criou a solicitação pode enviá-la.");
    }

    if (request.lines.length === 0) {
      throw new BusinessRuleError("A solicitação não tem itens.");
    }

    // Recalcula a disponibilidade no envio: o saldo pode ter mudado.
    const availability = await classifyAvailability(
      tx,
      request.branchId,
      request.lines.map((line) => ({
        itemId: line.itemId,
        quantity: line.requestedQuantity,
      })),
    );

    for (const line of request.lines) {
      const itemId = line.itemId;
      const status = availability.get(itemId);

      if (status) {
        await tx.requestLine.updateMany({
          where: { requestId, itemId },
          data: { availabilityStatus: status },
        });
      }
    }

    const responsibleId =
      request.branch.defaultApproverId ?? request.branch.notificationResponsibleId;

    await tx.request.update({
      where: { id: requestId },
      data: { status: "SUBMITTED", responsibleId },
    });

    await tx.requestEvent.create({
      data: {
        requestId,
        actorId: context.user.id,
        type: "SUBMITTED",
        fromStatus: request.status,
        toStatus: "SUBMITTED",
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "request.submitted",
        entityType: "Request",
        entityId: requestId,
        branchId: request.branchId,
        after: { status: "SUBMITTED", responsibleId },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    // Notifica quem aprova na unidade — na MESMA transação do envio.
    await notify(tx, {
      type: "REQUEST_CREATED",
      actorId: context.user.id,
      branchId: request.branchId,
      entityType: "Request",
      entityId: request.id,
      data: {
        requestId: request.id,
        number: request.number,
        requesterName: context.user.name,
        itemCount: String(request.lines.length),
        priority: request.status,
      },
    });

    log.info("solicitação enviada para aprovação", {
      requestId,
      number: request.number,
      branchId: request.branchId,
    });

    return { number: request.number, responsibleId };
  });
}

/** Assume a análise, evitando que dois aprovadores decidam o mesmo pedido. */
export async function claimRequest(
  context: AuthContext,
  requestId: string,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.request.findUnique({
      where: { id: requestId },
      select: { id: true, status: true, branchId: true, claimedById: true },
    });

    if (!request) throw new NotFoundError("Solicitação");

    assertBranchAccess(context, request.branchId);

    if (request.claimedById && request.claimedById !== context.user.id) {
      const other = await tx.user.findUnique({
        where: { id: request.claimedById },
        select: { name: true },
      });

      throw new BusinessRuleError(
        `Esta solicitação está em análise por ${other?.name ?? "outro aprovador"}.`,
      );
    }

    if (request.status === "SUBMITTED") {
      assertTransition("SUBMITTED", "IN_REVIEW");

      await tx.request.update({
        where: { id: requestId },
        data: { status: "IN_REVIEW", claimedById: context.user.id, claimedAt: new Date() },
      });

      await tx.requestEvent.create({
        data: {
          requestId,
          actorId: context.user.id,
          type: "CLAIMED",
          fromStatus: "SUBMITTED",
          toStatus: "IN_REVIEW",
        },
      });

      await writeAuditLog(
        {
          actorId: context.user.id,
          action: "request.claimed",
          entityType: "Request",
          entityId: requestId,
          branchId: request.branchId,
          after: { status: "IN_REVIEW" },
          ip: metadata?.ip,
          userAgent: metadata?.userAgent,
        },
        tx,
      );
    }

    await notify(tx, {
      type: "REQUEST_CLAIMED",
      actorId: context.user.id,
      branchId: request.branchId,
      entityType: "Request",
      entityId: request.id,
      data: { requestId: request.id, claimerName: context.user.name },
    });

    return { claimed: true };
  });
}

/* -------------------------------------------------------------------------- */
/* Decisão                                                                     */
/* -------------------------------------------------------------------------- */

export type ApproveInput = {
  requestId: string;
  /**
   * Prioridade definida por quem **recebe** o chamado.
   *
   * Faz sentido aqui e não na abertura: quem abre não tem como saber se o que
   * pediu é urgente para a operação — quem separa o material, sim.
   */
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  lines: Array<{
    lineId: string;
    approvedQuantity: string;
    nonApprovalReason?: string;
  }>;
  comment?: string;
};

/**
 * Aprova (total ou parcialmente) e **reserva o saldo**.
 *
 * Se qualquer linha aprovada não tiver saldo, a transação inteira volta atrás:
 * o aprovador precisa decidir com os números corretos, não com uma aprovação
 * pela metade.
 */
export async function approveRequest(
  context: AuthContext,
  input: ApproveInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(
    async (tx) => {
      const request = await tx.request.findUnique({
        where: { id: input.requestId },
        select: {
          id: true,
          number: true,
          status: true,
          branchId: true,
          requesterId: true,
          lines: {
            select: { id: true, itemId: true, requestedQuantity: true, approvedQuantity: true },
          },
        },
      });

      if (!request) throw new NotFoundError("Solicitação");

      assertBranchAccess(context, request.branchId);

      if (request.status !== "SUBMITTED" && request.status !== "IN_REVIEW") {
        throw new BusinessRuleError(
          "Só é possível decidir solicitações aguardando aprovação ou em análise.",
        );
      }

      const lineById = new Map(request.lines.map((line) => [line.id, line]));

      const decisions = input.lines
        .map((decision) => {
          const line = lineById.get(decision.lineId);
          if (!line) return null;

          return {
            line,
            approvedQuantity: new Prisma.Decimal(decision.approvedQuantity),
            decision,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      if (decisions.length === 0) {
        throw new BusinessRuleError("Informe a quantidade aprovada de pelo menos um item.");
      }

      for (const decision of decisions) {
        if (decision.approvedQuantity.isNegative()) {
          throw new BusinessRuleError("A quantidade aprovada não pode ser negativa.");
        }

        if (decision.approvedQuantity.greaterThan(decision.line.requestedQuantity)) {
          throw new BusinessRuleError("A quantidade aprovada não pode ser maior que a solicitada.");
        }

        // Aprovar menos do que foi pedido exige motivo: o solicitante precisa
        // entender por que recebeu menos.
        const isPartial = decision.approvedQuantity.lessThan(decision.line.requestedQuantity);

        if (isPartial && !decision.decision.nonApprovalReason) {
          throw new BusinessRuleError(
            "Informe o motivo quando aprovar uma quantidade menor que a solicitada.",
          );
        }
      }

      // Grava as quantidades aprovadas.
      for (const decision of decisions) {
        await tx.requestLine.update({
          where: { id: decision.line.id },
          data: {
            approvedQuantity: decision.approvedQuantity,
            nonApprovalReason: decision.decision.nonApprovalReason ?? null,
          },
        });
      }

      // Reserva o saldo de tudo que foi aprovado com quantidade positiva.
      const toReserve = decisions
        .filter((decision) => decision.approvedQuantity.greaterThan(0))
        .map((decision) => ({
          requestLineId: decision.line.id,
          itemId: decision.line.itemId,
          quantity: decision.approvedQuantity,
        }));

      if (toReserve.length > 0) {
        await reserveStock(tx, {
          branchId: request.branchId,
          createdById: context.user.id,
          lines: toReserve,
        });
      }

      const approvedTotal = decisions.reduce(
        (total, decision) => total.plus(decision.approvedQuantity),
        new Prisma.Decimal(0),
      );
      const requestedTotal = decisions.reduce(
        (total, decision) => total.plus(decision.line.requestedQuantity),
        new Prisma.Decimal(0),
      );

      // Linhas ausentes da decisão ficam com zero aprovado.
      const untouched = request.lines.filter(
        (line) => !decisions.some((decision) => decision.line.id === line.id),
      );

      for (const line of untouched) {
        await tx.requestLine.update({
          where: { id: line.id },
          data: { approvedQuantity: new Prisma.Decimal(0) },
        });
      }

      const fullyApproved =
        untouched.length === 0 && approvedTotal.greaterThanOrEqualTo(requestedTotal);

      const nextStatus: RequestStatus = fullyApproved ? "APPROVED" : "PARTIALLY_APPROVED";

      await tx.request.update({
        where: { id: request.id },
        data: {
          status: nextStatus,
          ...(input.priority ? { priority: input.priority } : {}),
          decidedById: context.user.id,
          decidedAt: new Date(),
          claimedById: context.user.id,
          claimedAt: new Date(),
        },
      });

      await tx.requestEvent.create({
        data: {
          requestId: request.id,
          actorId: context.user.id,
          type: fullyApproved ? "APPROVED" : "PARTIALLY_APPROVED",
          fromStatus: request.status,
          toStatus: nextStatus,
          comment: input.comment,
        },
      });

      await writeAuditLog(
        {
          actorId: context.user.id,
          action: fullyApproved ? "request.approved" : "request.partially_approved",
          entityType: "Request",
          entityId: request.id,
          branchId: request.branchId,
          after: {
            status: nextStatus,
            reserved: toReserve.length,
            approvedTotal: approvedTotal.toString(),
          },
          ip: metadata?.ip,
          userAgent: metadata?.userAgent,
        },
        tx,
      );

      await notify(tx, {
        type: fullyApproved ? "REQUEST_APPROVED" : "REQUEST_PARTIALLY_APPROVED",
        actorId: context.user.id,
        branchId: request.branchId,
        entityType: "Request",
        entityId: request.id,
        data: {
          requestId: request.id,
          number: request.number,
          requesterId: request.requesterId,
          deciderName: context.user.name,
        },
      });

      log.info("solicitação decidida", {
        requestId: request.id,
        number: request.number,
        status: nextStatus,
      });

      return { status: nextStatus, fullyApproved };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

export async function rejectRequest(
  context: AuthContext,
  input: { requestId: string; reason: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.request.findUnique({
      where: { id: input.requestId },
      select: { id: true, number: true, status: true, branchId: true, requesterId: true },
    });

    if (!request) throw new NotFoundError("Solicitação");

    assertBranchAccess(context, request.branchId);
    assertTransition(request.status, "REJECTED");

    await tx.request.update({
      where: { id: request.id },
      data: {
        status: "REJECTED",
        rejectionReason: input.reason,
        decidedById: context.user.id,
        decidedAt: new Date(),
      },
    });

    await tx.requestEvent.create({
      data: {
        requestId: request.id,
        actorId: context.user.id,
        type: "REJECTED",
        fromStatus: request.status,
        toStatus: "REJECTED",
        comment: input.reason,
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "request.rejected",
        entityType: "Request",
        entityId: request.id,
        branchId: request.branchId,
        after: { status: "REJECTED", reason: input.reason },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    await notify(tx, {
      type: "REQUEST_REJECTED",
      actorId: context.user.id,
      branchId: request.branchId,
      entityType: "Request",
      entityId: request.id,
      data: {
        requestId: request.id,
        number: request.number,
        requesterId: request.requesterId,
        reason: input.reason,
      },
    });

    return { number: request.number };
  });
}

export async function startPreparation(
  context: AuthContext,
  requestId: string,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.request.findUnique({
      where: { id: requestId },
      select: { id: true, status: true, branchId: true },
    });

    if (!request) throw new NotFoundError("Solicitação");

    assertBranchAccess(context, request.branchId);
    assertTransition(request.status, "IN_PREPARATION");

    await tx.request.update({ where: { id: requestId }, data: { status: "IN_PREPARATION" } });

    await tx.requestEvent.create({
      data: {
        requestId,
        actorId: context.user.id,
        type: "PREPARATION_STARTED",
        fromStatus: request.status,
        toStatus: "IN_PREPARATION",
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "request.preparation_started",
        entityType: "Request",
        entityId: requestId,
        branchId: request.branchId,
        after: { status: "IN_PREPARATION" },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Entrega                                                                     */
/* -------------------------------------------------------------------------- */

export type DeliverInput = {
  requestId: string;
  receivedByName: string;
  receivedByDocument?: string;
  notes?: string;
  lines: Array<{ lineId: string; deliveredQuantity: string }>;
};

/**
 * Entrega a solicitação: baixa o estoque, consome a reserva e gera o
 * comprovante.
 *
 * A entrega pode ser menor que o aprovado — nesse caso a diferença da reserva
 * é liberada de volta para o disponível.
 */
export async function deliverRequest(
  context: AuthContext,
  input: DeliverInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(
    async (tx) => {
      const request = await tx.request.findUnique({
        where: { id: input.requestId },
        select: {
          id: true,
          number: true,
          status: true,
          branchId: true,
          requesterId: true,
          lines: {
            select: {
              id: true,
              itemId: true,
              approvedQuantity: true,
              deliveredQuantity: true,
              reservation: {
                select: { id: true, quantity: true, status: true, stockLevelId: true },
              },
            },
          },
        },
      });

      if (!request) throw new NotFoundError("Solicitação");

      assertBranchAccess(context, request.branchId);

      if (
        request.status !== "APPROVED" &&
        request.status !== "PARTIALLY_APPROVED" &&
        request.status !== "IN_PREPARATION"
      ) {
        throw new BusinessRuleError("Só é possível entregar solicitação aprovada.");
      }

      const lineById = new Map(request.lines.map((line) => [line.id, line]));

      const deliveries = input.lines
        .map((delivery) => {
          const line = lineById.get(delivery.lineId);
          if (!line) return null;

          return { line, quantity: new Prisma.Decimal(delivery.deliveredQuantity) };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      const toDeliver = deliveries.filter((entry) => entry.quantity.greaterThan(0));

      if (toDeliver.length === 0) {
        throw new BusinessRuleError(
          "Informe a quantidade entregue de pelo menos um item. Para encerrar sem entregar, cancele a solicitação.",
        );
      }

      // Todas as linhas entregues precisam ter reserva ativa: é a reserva que
      // garante que o material está separado para este pedido.
      for (const delivery of toDeliver) {
        const reservation = delivery.line.reservation;

        if (!reservation || reservation.status !== "ACTIVE") {
          throw new BusinessRuleError(
            "Este item não tem reserva ativa. A solicitação precisa ser aprovada antes da entrega.",
          );
        }

        if (delivery.quantity.greaterThan(reservation.quantity)) {
          throw new BusinessRuleError(
            "A quantidade entregue não pode ser maior que a reservada para o item.",
          );
        }
      }

      const locationId = toDeliver[0]?.line.reservation?.stockLevelId;

      if (!locationId) {
        throw new BusinessRuleError(
          "Não foi possível identificar o local de retirada do material.",
        );
      }

      const stockLevel = await tx.stockLevel.findUniqueOrThrow({
        where: { id: locationId },
        select: { storageLocationId: true },
      });

      // Um documento de saída para toda a entrega.
      const document = await postStockDocument(tx, {
        type: "ISSUE",
        branchId: request.branchId,
        storageLocationId: stockLevel.storageLocationId,
        notes: `Entrega da solicitação ${request.number}`,
        referenceType: "REQUEST",
        referenceId: request.id,
        createdById: context.user.id,
        lines: toDeliver.map((delivery) => ({
          itemId: delivery.line.itemId,
          quantity: delivery.quantity.negated(),
          // A reserva desta linha vira saída real.
          releaseReserved: delivery.quantity,
        })),
      });

      for (const delivery of toDeliver) {
        await consumeReservation(tx, {
          requestLineId: delivery.line.id,
          quantity: delivery.quantity,
        });

        await tx.requestLine.update({
          where: { id: delivery.line.id },
          data: {
            deliveredQuantity: delivery.line.deliveredQuantity.plus(delivery.quantity),
          },
        });
      }

      // O que foi aprovado mas não será entregue volta para o disponível.
      for (const line of request.lines) {
        const delivered = deliveries.find((entry) => entry.line.id === line.id);
        const reservation = line.reservation;

        if (!reservation || reservation.status !== "ACTIVE") continue;

        const deliveredNow = delivered?.quantity ?? new Prisma.Decimal(0);
        const leftover = reservation.quantity.minus(deliveredNow);

        if (leftover.greaterThan(0)) {
          await releaseReservation(tx, {
            requestLineId: line.id,
            quantity: leftover,
          });
        }
      }

      const delivery = await tx.delivery.create({
        data: {
          requestId: request.id,
          branchId: request.branchId,
          deliveredById: context.user.id,
          receivedByName: input.receivedByName,
          receivedByDocument: input.receivedByDocument,
          stockDocumentId: document.documentId,
          notes: input.notes,
        },
        select: { id: true },
      });

      await tx.request.update({
        where: { id: request.id },
        data: { status: "DELIVERED", deliveredAt: new Date() },
      });

      await tx.requestEvent.create({
        data: {
          requestId: request.id,
          actorId: context.user.id,
          type: "DELIVERED",
          fromStatus: request.status,
          toStatus: "DELIVERED",
          comment: input.notes,
          metadata: {
            stockDocumentNumber: document.number,
            receivedByName: input.receivedByName,
          },
        },
      });

      await writeAuditLog(
        {
          actorId: context.user.id,
          action: "request.delivered",
          entityType: "Request",
          entityId: request.id,
          branchId: request.branchId,
          after: {
            status: "DELIVERED",
            stockDocumentNumber: document.number,
            receivedByName: input.receivedByName,
          },
          ip: metadata?.ip,
          userAgent: metadata?.userAgent,
        },
        tx,
      );

      await notify(tx, {
        type: "REQUEST_DELIVERED",
        actorId: context.user.id,
        branchId: request.branchId,
        entityType: "Request",
        entityId: request.id,
        data: {
          requestId: request.id,
          number: request.number,
          requesterId: request.requesterId,
          receivedByName: input.receivedByName,
        },
      });

      log.info("solicitação entregue", {
        requestId: request.id,
        number: request.number,
        documentNumber: document.number,
      });

      return { deliveryId: delivery.id, documentNumber: document.number };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

export async function cancelRequest(
  context: AuthContext,
  input: { requestId: string; reason?: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.request.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        number: true,
        status: true,
        branchId: true,
        requesterId: true,
        lines: { select: { id: true, reservation: { select: { status: true } } } },
      },
    });

    if (!request) throw new NotFoundError("Solicitação");

    assertBranchAccess(context, request.branchId);
    assertTransition(request.status, "CANCELLED");

    // Cancela quem criou ou quem aprova na unidade: o solicitante pode ter
    // saído da empresa e o material nunca seria retirado.
    const isOwner = request.requesterId === context.user.id;
    const canApprove = context.hasPermission("solicitacao:approve", request.branchId);

    if (!isOwner && !canApprove) {
      throw new BusinessRuleError(
        "Somente quem criou a solicitação (ou um aprovador da unidade) pode cancelá-la.",
      );
    }

    // Libera tudo que estava reservado por este pedido.
    for (const line of request.lines) {
      if (line.reservation?.status === "ACTIVE") {
        await releaseReservation(tx, { requestLineId: line.id });
      }
    }

    await tx.request.update({
      where: { id: request.id },
      data: { status: "CANCELLED", rejectionReason: input.reason },
    });

    await tx.requestEvent.create({
      data: {
        requestId: request.id,
        actorId: context.user.id,
        type: "CANCELLED",
        fromStatus: request.status,
        toStatus: "CANCELLED",
        comment: input.reason,
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "request.cancelled",
        entityType: "Request",
        entityId: request.id,
        branchId: request.branchId,
        before: { status: request.status },
        after: { status: "CANCELLED", reason: input.reason },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return { number: request.number };
  });
}

/** Total estimado da solicitação, para exibir valor e priorizar aprovação. */
export function estimateRequestValue(
  lines: readonly { requestedQuantity: Prisma.Decimal; unitPriceSnapshot: Prisma.Decimal | null }[],
): Prisma.Decimal {
  return lines
    .reduce(
      (total, line) =>
        total.plus(
          computeLineTotal(line.requestedQuantity, line.unitPriceSnapshot ?? new Prisma.Decimal(0)),
        ),
      new Prisma.Decimal(0),
    )
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Horas desde o envio — usado para o indicador de SLA da fila. */
export function hoursSince(date: Date | null): number | null {
  if (!date) return null;

  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
}
