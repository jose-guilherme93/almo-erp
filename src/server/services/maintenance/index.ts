import type { Prisma } from "@/generated/prisma/client";
import type { MaintenanceCategory, MaintenanceStatus } from "@/generated/prisma/enums";
import { BusinessRuleError, InvalidTransitionError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/server/services/audit";
import { createAttachmentRows, type AttachmentInput } from "@/server/services/attachment";
import { notify } from "@/server/services/notification";
import { getServiceSectorForCategory } from "@/server/services/sector";
import { nextMaintenanceNumber } from "@/server/services/stock/numbering";
import type { AuthContext } from "@/server/auth/context";
import { assertBranchAccess, visibleBranchIds } from "@/server/auth/scope";

const log = logger.with({ service: "maintenance" });

/**
 * Serviço de chamados de reparo.
 *
 * Um chamado não tem itens nem estoque: é um pedido de serviço ("o
 * ar-condicionado da sala 3 parou"). Por isso vive separado da solicitação de
 * material — misturar os dois obrigaria a inventar campos vazios nos dois lados.
 *
 * Duas regras que valem a pena destacar:
 *  - a **prioridade é definida por quem recebe**, não por quem abre;
 *  - a unidade é **escolhida por quem abre**, entre todas as ativas.
 */

const TRANSITIONS: Record<MaintenanceStatus, readonly MaintenanceStatus[]> = {
  OPEN: ["IN_REVIEW", "IN_PROGRESS", "REJECTED", "CANCELLED"],
  IN_REVIEW: ["IN_PROGRESS", "REJECTED", "CANCELLED"],
  IN_PROGRESS: ["WAITING_PARTS", "DONE", "CANCELLED"],
  WAITING_PARTS: ["IN_PROGRESS", "DONE", "CANCELLED"],
  DONE: [],
  REJECTED: [],
  CANCELLED: [],
};

function assertTransition(from: MaintenanceStatus, to: MaintenanceStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError(from, to, "o chamado");
  }
}

/** Estados que ainda contam como "aberto" nos indicadores. */
export const OPEN_MAINTENANCE_STATUSES: readonly MaintenanceStatus[] = [
  "OPEN",
  "IN_REVIEW",
  "IN_PROGRESS",
  "WAITING_PARTS",
];

/** Estados terminais: chamados encerrados, recusados ou cancelados. */
export const CLOSED_MAINTENANCE_STATUSES: readonly MaintenanceStatus[] = [
  "DONE",
  "REJECTED",
  "CANCELLED",
];

export const MAINTENANCE_CATEGORY_LABELS: Record<string, string> = {
  ELECTRICAL: "Elétrica",
  PLUMBING: "Hidráulica",
  HVAC: "Ar-condicionado / climatização",
  FURNITURE: "Mobiliário",
  CIVIL: "Alvenaria e estrutura",
  IT: "Informática e redes",
  EQUIPMENT: "Equipamentos e máquinas",
  CLEANING: "Limpeza e conservação",
  OTHER: "Outros",
};

export const MAINTENANCE_STATUS_LABELS: Record<string, string> = {
  OPEN: "Aberto",
  IN_REVIEW: "Em análise",
  IN_PROGRESS: "Em andamento",
  WAITING_PARTS: "Aguardando peça",
  DONE: "Concluído",
  REJECTED: "Recusado",
  CANCELLED: "Cancelado",
};

/* -------------------------------------------------------------------------- */
/* Consultas                                                                   */
/* -------------------------------------------------------------------------- */

function visibilityFilter(context: AuthContext, branchId?: string | null) {
  if (branchId) {
    assertBranchAccess(context, branchId);
    return { branchId };
  }

  // Visão geral do setor (manutenção/TI/matriz): tudo do escopo de filiais.
  if (context.hasPermission("manutencao:overview")) {
    return { branchId: { in: visibleBranchIds(context) } };
  }

  // Sem visão geral, a pessoa vê:
  //  - o que ela mesma abriu (mesmo em outra unidade — §3.7);
  //  - o que foi atribuído a ela, encaminhado ao seu setor, ou roteado ao
  //    setor de atendimento dela (ex.: chamado de TI com serviceSectorId = TI),
  //    sempre dentro das filiais a que tem acesso.
  return {
    OR: [
      { requesterId: context.user.id },
      {
        branchId: { in: visibleBranchIds(context) },
        OR: [
          { assignedToId: context.user.id },
          { delegations: { some: { toSectorId: { in: context.sectorIds } } } },
          { serviceSectorId: { in: context.sectorIds } },
        ],
      },
    ],
  };
}

export type MaintenanceListFilters = {
  search?: string;
  status?: string | null;
  /** Lista de status (visão "em aberto" / "concluídos"). Tem precedência sobre `status`. */
  statuses?: readonly MaintenanceStatus[] | null;
  category?: string | null;
  priority?: string | null;
  branchId?: string | null;
  sectorId?: string | null;
  mineOnly?: boolean;
  assignedToMe?: boolean;
  page?: number;
  pageSize?: number;
};

export async function listMaintenanceRequests(
  context: AuthContext,
  filters: MaintenanceListFilters = {},
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));

  // Escopo e busca combinados com `AND`: se fossem espalhados no mesmo objeto, o
  // `OR` da busca sobrescreveria o `OR` da visibilidade e o usuário enxergaria
  // chamado de outra filial.
  const where: Prisma.MaintenanceRequestWhereInput = {
    AND: [
      visibilityFilter(context, filters.branchId ?? null),
      {
        ...(filters.statuses && filters.statuses.length > 0
          ? { status: { in: [...filters.statuses] } }
          : filters.status
            ? { status: filters.status as MaintenanceStatus }
            : {}),
        ...(filters.category ? { category: filters.category as MaintenanceCategory } : {}),
        ...(filters.priority
          ? { priority: filters.priority as "LOW" | "NORMAL" | "HIGH" | "URGENT" }
          : {}),
        ...(filters.sectorId ? { sectorId: filters.sectorId } : {}),
        ...(filters.mineOnly ? { requesterId: context.user.id } : {}),
        ...(filters.assignedToMe ? { assignedToId: context.user.id } : {}),
        ...(filters.search
          ? {
              OR: [
                { number: { contains: filters.search, mode: "insensitive" } },
                { title: { contains: filters.search, mode: "insensitive" } },
                { location: { contains: filters.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    ],
  };

  const [items, total] = await Promise.all([
    prisma.maintenanceRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        number: true,
        title: true,
        location: true,
        category: true,
        status: true,
        priority: true,
        createdAt: true,
        completedAt: true,
        branch: { select: { id: true, code: true, name: true } },
        sector: { select: { id: true, code: true, name: true } },
        requester: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    }),
    prisma.maintenanceRequest.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getMaintenanceRequest(context: AuthContext, requestId: string) {
  const request = await prisma.maintenanceRequest.findFirst({
    where: { id: requestId, ...visibilityFilter(context) },
    select: {
      id: true,
      number: true,
      title: true,
      description: true,
      location: true,
      assetTag: true,
      category: true,
      status: true,
      priority: true,
      resolution: true,
      rejectReason: true,
      resolutionHours: true,
      createdAt: true,
      claimedAt: true,
      assignedAt: true,
      completedAt: true,
      branch: { select: { id: true, code: true, name: true } },
      sector: { select: { id: true, code: true, name: true } },
      serviceSector: { select: { id: true, code: true, name: true } },
      requester: { select: { id: true, name: true, email: true } },
      responsible: { select: { id: true, name: true } },
      claimedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
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

  if (!request) throw new NotFoundError("Chamado");

  return request;
}

/** O usuário enxerga este chamado? Usado para liberar os anexos. */
export async function canViewMaintenance(
  context: AuthContext,
  requestId: string,
): Promise<boolean> {
  const count = await prisma.maintenanceRequest.count({
    where: { id: requestId, ...visibilityFilter(context) },
  });

  return count > 0;
}

/** Fila de atendimento da unidade: o que está aberto, mais urgente primeiro. */
export async function listMaintenanceQueue(
  context: AuthContext,
  branchId: string,
  options: { page?: number; pageSize?: number } = {},
) {
  assertBranchAccess(context, branchId);

  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));

  const where: Prisma.MaintenanceRequestWhereInput = {
    branchId,
    status: { in: [...OPEN_MAINTENANCE_STATUSES] },
  };

  const [items, total] = await Promise.all([
    prisma.maintenanceRequest.findMany({
      where,
      // Sem prioridade definida vem primeiro: é o que ainda precisa de triagem.
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        number: true,
        title: true,
        location: true,
        category: true,
        status: true,
        priority: true,
        createdAt: true,
        requester: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
    }),
    prisma.maintenanceRequest.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Indicadores do dashboard: abertos, sem prioridade e parados há mais de 3 dias. */
export async function maintenanceSummary(branchIds: readonly string[]) {
  const [byStatus, withoutPriority, stalled, done] = await Promise.all([
    prisma.maintenanceRequest.groupBy({
      by: ["status"],
      where: { branchId: { in: [...branchIds] } },
      _count: { _all: true },
    }),
    prisma.maintenanceRequest.count({
      where: {
        branchId: { in: [...branchIds] },
        status: { in: [...OPEN_MAINTENANCE_STATUSES] },
        priority: null,
      },
    }),
    prisma.maintenanceRequest.count({
      where: {
        branchId: { in: [...branchIds] },
        status: { in: [...OPEN_MAINTENANCE_STATUSES] },
        createdAt: { lt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.maintenanceRequest.findMany({
      where: {
        branchId: { in: [...branchIds] },
        status: "DONE",
        completedAt: { not: null },
        resolutionHours: { not: null },
      },
      select: { resolutionHours: true },
    }),
  ]);

  const open = byStatus
    .filter((row) => OPEN_MAINTENANCE_STATUSES.includes(row.status))
    .reduce((total, row) => total + row._count._all, 0);

  const averageResolutionHours =
    done.length > 0
      ? done.reduce((total, row) => total + (row.resolutionHours ?? 0), 0) / done.length
      : null;

  return { open, withoutPriority, stalled, byStatus, averageResolutionHours };
}

/* -------------------------------------------------------------------------- */
/* Abertura                                                                    */
/* -------------------------------------------------------------------------- */

export type CreateMaintenanceInput = {
  branchId: string;
  sectorId?: string | null;
  category: string;
  title: string;
  description: string;
  location: string;
  assetTag?: string;
  attachments?: AttachmentInput[];
};

/**
 * Abre um chamado de reparo.
 *
 * Nasce `OPEN` e **sem prioridade**: quem recebe é que decide se é urgente.
 * A unidade é escolhida por quem abre, entre todas as ativas.
 */
export async function createMaintenanceRequest(
  context: AuthContext,
  input: CreateMaintenanceInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const branch = await prisma.branch.findFirst({
    where: { id: input.branchId, active: true },
    select: {
      id: true,
      name: true,
      notificationResponsibleId: true,
      defaultApproverId: true,
      warehouseResponsibleId: true,
    },
  });

  if (!branch) {
    throw new BusinessRuleError("A unidade escolhida está inativa ou não existe.");
  }

  // O responsável pela manutenção costuma ser quem acompanha a unidade.
  const responsibleId =
    branch.notificationResponsibleId ??
    branch.warehouseResponsibleId ??
    branch.defaultApproverId ??
    null;

  return prisma.$transaction(
    async (tx) => {
      const number = await nextMaintenanceNumber(tx, input.branchId);

      // O setor que atende depende da categoria: TI vai para a TI, o resto
      // fica com a manutenção.
      const sectorId = input.sectorId ?? context.activeSectorId ?? null;
      const serviceSectorId = await getServiceSectorForCategory(input.category, tx);

      const request = await tx.maintenanceRequest.create({
        data: {
          number,
          branchId: input.branchId,
          requesterId: context.user.id,
          sectorId,
          serviceSectorId,
          category: input.category as MaintenanceCategory,
          status: "OPEN",
          title: input.title,
          description: input.description,
          location: input.location,
          assetTag: input.assetTag,
          responsibleId,
        },
        select: { id: true, number: true },
      });

      await createAttachmentRows(tx, {
        attachments: input.attachments ?? [],
        uploadedById: context.user.id,
        maintenanceRequestId: request.id,
      });

      await tx.maintenanceEvent.create({
        data: {
          requestId: request.id,
          actorId: context.user.id,
          type: "CREATED",
          toStatus: "OPEN",
        },
      });

      await writeAuditLog(
        {
          actorId: context.user.id,
          action: "maintenance.created",
          entityType: "MaintenanceRequest",
          entityId: request.id,
          branchId: input.branchId,
          after: {
            number,
            category: input.category,
            title: input.title,
            location: input.location,
          },
          ip: metadata?.ip,
          userAgent: metadata?.userAgent,
        },
        tx,
      );

      await notify(tx, {
        type: "MAINTENANCE_CREATED",
        actorId: context.user.id,
        branchId: input.branchId,
        entityType: "MaintenanceRequest",
        entityId: request.id,
        data: {
          maintenanceId: request.id,
          number,
          requesterName: context.user.name,
          title: input.title,
          location: input.location,
          serviceSectorId,
        },
      });

      log.info("chamado de reparo aberto", {
        maintenanceId: request.id,
        number,
        branchId: input.branchId,
      });

      return request;
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

/* -------------------------------------------------------------------------- */
/* Atendimento                                                                 */
/* -------------------------------------------------------------------------- */

/** Assume o atendimento, saindo da fila. */
export async function claimMaintenanceRequest(
  context: AuthContext,
  requestId: string,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.findUnique({
      where: { id: requestId },
      select: { id: true, number: true, status: true, branchId: true, claimedById: true },
    });

    if (!request) throw new NotFoundError("Chamado");

    assertBranchAccess(context, request.branchId);

    if (request.claimedById && request.claimedById !== context.user.id) {
      const other = await tx.user.findUnique({
        where: { id: request.claimedById },
        select: { name: true },
      });

      throw new BusinessRuleError(`Este chamado já está com ${other?.name ?? "outra pessoa"}.`);
    }

    if (request.status === "OPEN") {
      assertTransition("OPEN", "IN_REVIEW");

      await tx.maintenanceRequest.update({
        where: { id: requestId },
        data: { status: "IN_REVIEW", claimedById: context.user.id, claimedAt: new Date() },
      });

      await tx.maintenanceEvent.create({
        data: {
          requestId,
          actorId: context.user.id,
          type: "CLAIMED",
          fromStatus: "OPEN",
          toStatus: "IN_REVIEW",
        },
      });

      await writeAuditLog(
        {
          actorId: context.user.id,
          action: "maintenance.claimed",
          entityType: "MaintenanceRequest",
          entityId: requestId,
          branchId: request.branchId,
          after: { status: "IN_REVIEW" },
          ip: metadata?.ip,
          userAgent: metadata?.userAgent,
        },
        tx,
      );
    }

    return { number: request.number };
  });
}

/**
 * Define a prioridade.
 *
 * Este é o ponto central do pedido: **quem recebe decide se é urgente**. Quem
 * abriu o chamado não tem como saber o que é crítico para a operação.
 */
export async function setMaintenancePriority(
  context: AuthContext,
  input: { requestId: string; priority: "LOW" | "NORMAL" | "HIGH" | "URGENT"; comment?: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        number: true,
        status: true,
        branchId: true,
        priority: true,
        requesterId: true,
      },
    });

    if (!request) throw new NotFoundError("Chamado");

    assertBranchAccess(context, request.branchId);

    if (request.status === "DONE" || request.status === "CANCELLED") {
      throw new BusinessRuleError("Não é possível definir prioridade de um chamado encerrado.");
    }

    await tx.maintenanceRequest.update({
      where: { id: request.id },
      data: { priority: input.priority },
    });

    await tx.maintenanceEvent.create({
      data: {
        requestId: request.id,
        actorId: context.user.id,
        type: "PRIORITY_SET",
        comment: input.comment,
        metadata: { from: request.priority, to: input.priority },
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "maintenance.priority_set",
        entityType: "MaintenanceRequest",
        entityId: request.id,
        branchId: request.branchId,
        before: { priority: request.priority },
        after: { priority: input.priority },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    // Quem abriu precisa saber que o chamado foi reconhecido.
    await notify(tx, {
      type: "MAINTENANCE_PRIORITY_SET",
      actorId: context.user.id,
      branchId: request.branchId,
      entityType: "MaintenanceRequest",
      entityId: request.id,
      data: {
        maintenanceId: request.id,
        number: request.number,
        requesterId: request.requesterId,
        priority: input.priority,
        deciderName: context.user.name,
      },
    });

    return { priority: input.priority };
  });
}

/** Atribui o chamado a quem vai executar o serviço. */
export async function assignMaintenanceRequest(
  context: AuthContext,
  input: { requestId: string; assignedToId: string; comment?: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.findUnique({
      where: { id: input.requestId },
      select: { id: true, number: true, status: true, branchId: true, requesterId: true },
    });

    if (!request) throw new NotFoundError("Chamado");

    assertBranchAccess(context, request.branchId);

    if (
      request.status === "DONE" ||
      request.status === "CANCELLED" ||
      request.status === "REJECTED"
    ) {
      throw new BusinessRuleError("Este chamado já foi encerrado.");
    }

    // Reatribuir um chamado já em andamento não é transição de status; nos
    // demais casos, o avanço para IN_PROGRESS passa pela máquina de estados.
    if (request.status !== "IN_PROGRESS") {
      assertTransition(request.status, "IN_PROGRESS");
    }

    const assignee = await tx.user.findFirst({
      where: {
        id: input.assignedToId,
        status: "ACTIVE",
        active: true,
        memberships: { some: { branchId: request.branchId, active: true } },
      },
      select: { id: true, name: true },
    });

    if (!assignee) {
      throw new BusinessRuleError(
        "A pessoa escolhida não tem acesso a esta unidade. Ative o vínculo antes de atribuir.",
      );
    }

    await tx.maintenanceRequest.update({
      where: { id: request.id },
      data: {
        assignedToId: assignee.id,
        assignedAt: new Date(),
        status: "IN_PROGRESS",
        claimedById: request.status === "OPEN" ? context.user.id : undefined,
        claimedAt: request.status === "OPEN" ? new Date() : undefined,
      },
    });

    await tx.maintenanceEvent.create({
      data: {
        requestId: request.id,
        actorId: context.user.id,
        type: "ASSIGNED",
        fromStatus: request.status,
        toStatus: "IN_PROGRESS",
        comment: input.comment,
        metadata: { assignedTo: assignee.name },
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "maintenance.assigned",
        entityType: "MaintenanceRequest",
        entityId: request.id,
        branchId: request.branchId,
        after: { assignedToId: assignee.id, status: "IN_PROGRESS" },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    // Quem vai executar recebe o chamado na caixa de entrada.
    await notify(tx, {
      type: "MAINTENANCE_ASSIGNED",
      actorId: context.user.id,
      branchId: request.branchId,
      entityType: "MaintenanceRequest",
      entityId: request.id,
      data: {
        maintenanceId: request.id,
        number: request.number,
        assignedToId: assignee.id,
        title: request.number,
      },
    });

    return { assignedTo: assignee.name };
  });
}

/** Registra andamento: aguardando peça ou retomada. */
export async function updateMaintenanceProgress(
  context: AuthContext,
  input: { requestId: string; status: "IN_PROGRESS" | "WAITING_PARTS"; comment: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        number: true,
        status: true,
        branchId: true,
        requesterId: true,
        assignedToId: true,
      },
    });

    if (!request) throw new NotFoundError("Chamado");

    assertBranchAccess(context, request.branchId);
    assertTransition(request.status, input.status);

    await tx.maintenanceRequest.update({
      where: { id: request.id },
      data: { status: input.status },
    });

    await tx.maintenanceEvent.create({
      data: {
        requestId: request.id,
        actorId: context.user.id,
        type: input.status === "WAITING_PARTS" ? "WAITING_PARTS" : "PROGRESS_UPDATED",
        fromStatus: request.status,
        toStatus: input.status,
        comment: input.comment,
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "maintenance.progress_updated",
        entityType: "MaintenanceRequest",
        entityId: request.id,
        branchId: request.branchId,
        before: { status: request.status },
        after: { status: input.status, comment: input.comment },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return { status: input.status };
  });
}

/** Conclui o chamado, registrando o que foi feito. */
export async function completeMaintenanceRequest(
  context: AuthContext,
  input: { requestId: string; resolution: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        number: true,
        status: true,
        branchId: true,
        requesterId: true,
        createdAt: true,
      },
    });

    if (!request) throw new NotFoundError("Chamado");

    assertBranchAccess(context, request.branchId);
    assertTransition(request.status, "DONE");

    const completedAt = new Date();
    const resolutionHours = Math.max(
      0,
      Math.round((completedAt.getTime() - request.createdAt.getTime()) / (1000 * 60 * 60)),
    );

    await tx.maintenanceRequest.update({
      where: { id: request.id },
      data: {
        status: "DONE",
        resolution: input.resolution,
        completedAt,
        resolutionHours,
      },
    });

    await tx.maintenanceEvent.create({
      data: {
        requestId: request.id,
        actorId: context.user.id,
        type: "COMPLETED",
        fromStatus: request.status,
        toStatus: "DONE",
        comment: input.resolution,
        metadata: { resolutionHours },
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "maintenance.completed",
        entityType: "MaintenanceRequest",
        entityId: request.id,
        branchId: request.branchId,
        before: { status: request.status },
        after: { status: "DONE", resolutionHours },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    await notify(tx, {
      type: "MAINTENANCE_DONE",
      actorId: context.user.id,
      branchId: request.branchId,
      entityType: "MaintenanceRequest",
      entityId: request.id,
      data: {
        maintenanceId: request.id,
        number: request.number,
        requesterId: request.requesterId,
        actorName: context.user.name,
      },
    });

    return { number: request.number, resolutionHours };
  });
}

/** Recusa o chamado, com motivo. */
export async function rejectMaintenanceRequest(
  context: AuthContext,
  input: { requestId: string; reason: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.findUnique({
      where: { id: input.requestId },
      select: { id: true, number: true, status: true, branchId: true, requesterId: true },
    });

    if (!request) throw new NotFoundError("Chamado");

    assertBranchAccess(context, request.branchId);
    assertTransition(request.status, "REJECTED");

    if (input.reason.trim().length < 5) {
      throw new BusinessRuleError("Explique o motivo da recusa.");
    }

    await tx.maintenanceRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED", rejectReason: input.reason },
    });

    await tx.maintenanceEvent.create({
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
        action: "maintenance.rejected",
        entityType: "MaintenanceRequest",
        entityId: request.id,
        branchId: request.branchId,
        after: { status: "REJECTED", reason: input.reason },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return { number: request.number };
  });
}

export async function cancelMaintenanceRequest(
  context: AuthContext,
  input: { requestId: string; reason?: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.findUnique({
      where: { id: input.requestId },
      select: { id: true, number: true, status: true, branchId: true, requesterId: true },
    });

    if (!request) throw new NotFoundError("Chamado");

    assertBranchAccess(context, request.branchId);
    assertTransition(request.status, "CANCELLED");

    const isOwner = request.requesterId === context.user.id;
    const canManage = context.hasPermission("manutencao:atender", request.branchId);

    if (!isOwner && !canManage) {
      throw new BusinessRuleError(
        "Somente quem abriu o chamado (ou quem atende manutenção) pode cancelá-lo.",
      );
    }

    await tx.maintenanceRequest.update({
      where: { id: request.id },
      data: { status: "CANCELLED", rejectReason: input.reason ?? null },
    });

    await tx.maintenanceEvent.create({
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
        action: "maintenance.cancelled",
        entityType: "MaintenanceRequest",
        entityId: request.id,
        branchId: request.branchId,
        before: { status: request.status },
        after: { status: "CANCELLED", reason: input.reason ?? null },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return { number: request.number };
  });
}

/**
 * Unidades que o usuário pode escolher ao abrir um chamado.
 *
 * Qualquer unidade ativa: o problema pode estar em outra unidade, e quem
 * resolve é quem recebe o chamado lá.
 */
export async function listRequestableBranchesForMaintenance(context: AuthContext) {
  void context;

  return prisma.branch.findMany({
    where: { active: true },
    orderBy: [{ type: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, type: true, city: true, state: true },
  });
}

/** Pessoas que podem receber um chamado nesta unidade. */
export async function listMaintenanceAssignees(context: AuthContext, branchId: string) {
  assertBranchAccess(context, branchId);

  return prisma.user.findMany({
    where: {
      status: "ACTIVE",
      active: true,
      memberships: { some: { branchId, active: true } },
      // Quem atende manutenção: o papel precisa ter a permissão.
      OR: [
        {
          memberships: {
            some: {
              branchId,
              active: true,
              role: { rolePermissions: { some: { permissionId: "manutencao:atender" } } },
            },
          },
        },
      ],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
