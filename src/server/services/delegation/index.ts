import type { DelegationStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { BusinessRuleError, InvalidTransitionError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/server/services/audit";
import { notify } from "@/server/services/notification";
import { getAlmoxarifadoSectorId } from "@/server/services/sector";
import type { AuthContext } from "@/server/auth/context";
import { visibleBranchIds } from "@/server/auth/scope";

const log = logger.with({ service: "delegation" });

/**
 * Encaminhamento de uma etapa de uma demanda para outro setor.
 *
 * O almoxarifado recebe uma solicitação e pode encaminhar uma fase ("analisar se
 * o defeito é de fabricação ou mau uso") à TI. Enquanto a etapa estiver aberta,
 * o setor de destino é quem responde; ao concluir com laudo, o comando volta
 * para o setor de origem, que segue até fechar a demanda.
 */

export type DelegationEntityType = "REQUEST" | "MAINTENANCE";

export const OPEN_DELEGATION_STATUSES: readonly DelegationStatus[] = [
  "PENDING",
  "ACCEPTED",
  "IN_PROGRESS",
];

const TRANSITIONS: Record<DelegationStatus, readonly DelegationStatus[]> = {
  PENDING: ["ACCEPTED", "IN_PROGRESS", "COMPLETED", "RETURNED", "CANCELLED"],
  ACCEPTED: ["IN_PROGRESS", "COMPLETED", "RETURNED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "RETURNED", "CANCELLED"],
  // Concluída ainda pode ser "devolvida": é o setor de origem encerrando a
  // etapa depois de retomar o comando da demanda.
  COMPLETED: ["RETURNED"],
  RETURNED: [],
  CANCELLED: [],
};

function assertTransition(from: DelegationStatus, to: DelegationStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError(from, to, "a etapa");
  }
}

export const DELEGATION_STATUS_LABELS: Record<string, string> = {
  PENDING: "Aguardando aceite",
  ACCEPTED: "Aceita",
  IN_PROGRESS: "Em análise",
  COMPLETED: "Concluída (laudo pronto)",
  RETURNED: "Devolvida",
  CANCELLED: "Cancelada",
};

/* -------------------------------------------------------------------------- */
/* Consultas                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Visibilidade de um encaminhamento.
 *
 * Só enxerga quem é do setor de origem, do setor de destino, quem tem visão de
 * rede, ou quem tem a visão geral do respectivo fluxo.
 */
function visibilityFilter(context: AuthContext): Prisma.DelegationWhereInput {
  if (context.isNetworkScope) return {};

  const fromViewerPermissions = context.hasPermission("solicitacao:overview")
    ? { requestId: { not: null } }
    : {};
  const fromMaintenancePermissions = context.hasPermission("manutencao:overview")
    ? { maintenanceRequestId: { not: null } }
    : {};

  if (fromViewerPermissions.requestId || fromMaintenancePermissions.maintenanceRequestId) {
    return {
      OR: [
        ...(fromViewerPermissions.requestId ? [fromViewerPermissions] : []),
        ...(fromMaintenancePermissions.maintenanceRequestId ? [fromMaintenancePermissions] : []),
        { fromSectorId: { in: context.sectorIds } },
        { toSectorId: { in: context.sectorIds } },
      ],
    };
  }

  return {
    OR: [{ fromSectorId: { in: context.sectorIds } }, { toSectorId: { in: context.sectorIds } }],
  };
}

const DETAIL_SELECT = {
  id: true,
  status: true,
  reason: true,
  report: true,
  createdAt: true,
  acceptedAt: true,
  completedAt: true,
  returnedAt: true,
  fromSector: { select: { id: true, code: true, name: true } },
  toSector: { select: { id: true, code: true, name: true } },
  requestedBy: { select: { id: true, name: true } },
  acceptedBy: { select: { id: true, name: true } },
  completedBy: { select: { id: true, name: true } },
  request: { select: { id: true, number: true, status: true, branchId: true } },
  maintenanceRequest: {
    select: { id: true, number: true, status: true, branchId: true, title: true },
  },
  events: {
    orderBy: { createdAt: "desc" as const },
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
} satisfies Prisma.DelegationSelect;

export async function getDelegation(context: AuthContext, delegationId: string) {
  const delegation = await prisma.delegation.findFirst({
    where: { id: delegationId, ...visibilityFilter(context) },
    select: DETAIL_SELECT,
  });

  if (!delegation) throw new NotFoundError("Etapa encaminhada");

  return delegation;
}

export type DelegationListFilters = {
  /** Apenas as etapas endereçadas ao meu setor. */
  forMySector?: boolean;
  status?: string | null;
  openOnly?: boolean;
  page?: number;
  pageSize?: number;
};

export async function listDelegations(context: AuthContext, filters: DelegationListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));

  const where: Prisma.DelegationWhereInput = {
    ...visibilityFilter(context),
    ...(filters.forMySector ? { toSectorId: { in: context.sectorIds } } : {}),
    ...(filters.status ? { status: filters.status as DelegationStatus } : {}),
    ...(filters.openOnly ? { status: { in: [...OPEN_DELEGATION_STATUSES] } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.delegation.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        reason: true,
        report: true,
        createdAt: true,
        completedAt: true,
        fromSector: { select: { id: true, code: true, name: true } },
        toSector: { select: { id: true, code: true, name: true } },
        requestedBy: { select: { name: true } },
        request: {
          select: { id: true, number: true, status: true, branch: { select: { code: true } } },
        },
        maintenanceRequest: { select: { id: true, number: true, title: true, status: true } },
      },
    }),
    prisma.delegation.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Encaminhamentos de uma demanda específica (para exibir no detalhe). */
export async function listDelegationsForEntity(
  context: AuthContext,
  entityType: DelegationEntityType,
  entityId: string,
) {
  return prisma.delegation.findMany({
    where: {
      ...(entityType === "REQUEST" ? { requestId: entityId } : { maintenanceRequestId: entityId }),
      ...visibilityFilter(context),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      reason: true,
      report: true,
      createdAt: true,
      completedAt: true,
      returnedAt: true,
      fromSector: { select: { id: true, name: true } },
      toSector: { select: { id: true, name: true } },
      requestedBy: { select: { name: true } },
      completedBy: { select: { name: true } },
    },
  });
}

/** A demanda está com outro setor agora? */
export async function findOpenDelegation(
  client: Prisma.TransactionClient | typeof prisma,
  entityType: DelegationEntityType,
  entityId: string,
) {
  return client.delegation.findFirst({
    where: {
      ...(entityType === "REQUEST" ? { requestId: entityId } : { maintenanceRequestId: entityId }),
      status: { in: [...OPEN_DELEGATION_STATUSES] },
    },
    select: { id: true, toSectorId: true, status: true },
  });
}

/* -------------------------------------------------------------------------- */
/* Comandos                                                                    */
/* -------------------------------------------------------------------------- */

type EntityRef = {
  branchId: string;
  number: string;
  serviceSectorId: string | null;
  closed: boolean;
  requesterId: string;
};

async function loadEntity(
  client: Prisma.TransactionClient,
  entityType: DelegationEntityType,
  entityId: string,
): Promise<EntityRef> {
  if (entityType === "REQUEST") {
    const request = await client.request.findUnique({
      where: { id: entityId },
      select: {
        branchId: true,
        number: true,
        serviceSectorId: true,
        status: true,
        requesterId: true,
      },
    });

    if (!request) throw new NotFoundError("Solicitação");

    return {
      branchId: request.branchId,
      number: request.number,
      serviceSectorId: request.serviceSectorId,
      closed: ["REJECTED", "CANCELLED", "DELIVERED"].includes(request.status),
      requesterId: request.requesterId,
    };
  }

  const maintenance = await client.maintenanceRequest.findUnique({
    where: { id: entityId },
    select: {
      branchId: true,
      number: true,
      serviceSectorId: true,
      status: true,
      requesterId: true,
    },
  });

  if (!maintenance) throw new NotFoundError("Chamado");

  return {
    branchId: maintenance.branchId,
    number: maintenance.number,
    serviceSectorId: maintenance.serviceSectorId,
    closed: ["REJECTED", "CANCELLED", "DONE"].includes(maintenance.status),
    requesterId: maintenance.requesterId,
  };
}

export type CreateDelegationInput = {
  entityType: DelegationEntityType;
  entityId: string;
  toSectorId: string;
  reason: string;
};

/**
 * Encaminha uma etapa da demanda para outro setor.
 *
 * O setor de origem é o setor do usuário que encaminha; na falta dele, o setor
 * que responde pela demanda (almoxarifado, por padrão).
 */
export async function createDelegation(
  context: AuthContext,
  input: CreateDelegationInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const target = await prisma.sector.findUnique({
    where: { id: input.toSectorId },
    select: { id: true, name: true, kind: true, active: true },
  });

  if (!target || !target.active) throw new NotFoundError("Setor");

  if (!["SERVICE", "BOTH"].includes(target.kind)) {
    throw new BusinessRuleError("O setor escolhido não atende demandas.");
  }

  return prisma.$transaction(async (tx) => {
    const entity = await loadEntity(tx, input.entityType, input.entityId);

    if (!visibleBranchIds(context).includes(entity.branchId) && !context.isNetworkScope) {
      throw new BusinessRuleError("Você não tem acesso a esta demanda.");
    }

    if (entity.closed) {
      throw new BusinessRuleError(
        "Esta demanda já foi encerrada e não aceita novos encaminhamentos.",
      );
    }

    const fromSectorId =
      context.activeSectorId ?? entity.serviceSectorId ?? (await getAlmoxarifadoSectorId(tx));

    if (!fromSectorId) {
      throw new BusinessRuleError(
        "Não foi possível identificar o setor de origem. Defina o setor do seu vínculo.",
      );
    }

    if (fromSectorId === input.toSectorId) {
      throw new BusinessRuleError("A demanda já está com este setor.");
    }

    const duplicate = await tx.delegation.findFirst({
      where: {
        toSectorId: input.toSectorId,
        status: { in: [...OPEN_DELEGATION_STATUSES] },
        ...(input.entityType === "REQUEST"
          ? { requestId: input.entityId }
          : { maintenanceRequestId: input.entityId }),
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new BusinessRuleError("Já existe uma etapa aberta para este setor nesta demanda.");
    }

    const fromSector = await tx.sector.findUniqueOrThrow({
      where: { id: fromSectorId },
      select: { name: true },
    });

    const delegation = await tx.delegation.create({
      data: {
        fromSectorId,
        toSectorId: input.toSectorId,
        status: "PENDING",
        reason: input.reason,
        requestedById: context.user.id,
        ...(input.entityType === "REQUEST"
          ? { requestId: input.entityId }
          : { maintenanceRequestId: input.entityId }),
      },
      select: { id: true },
    });

    await tx.delegationEvent.create({
      data: {
        delegationId: delegation.id,
        actorId: context.user.id,
        type: "CREATED",
        toStatus: "PENDING",
        comment: input.reason,
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "delegation.created",
        entityType: "Delegation",
        entityId: delegation.id,
        branchId: entity.branchId,
        after: {
          fromSectorId,
          toSectorId: input.toSectorId,
          entityType: input.entityType,
          entityId: input.entityId,
        },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    await notify(tx, {
      type: "DELEGATION_REQUESTED",
      actorId: context.user.id,
      branchId: entity.branchId,
      entityType: "Delegation",
      entityId: delegation.id,
      data: {
        delegationId: delegation.id,
        toSectorId: input.toSectorId,
        toSectorName: target.name,
        fromSectorId,
        fromSectorName: fromSector.name,
        reason: input.reason,
      },
    });

    log.info("etapa encaminhada", {
      delegationId: delegation.id,
      fromSectorId,
      toSectorId: input.toSectorId,
      entityType: input.entityType,
      entityId: input.entityId,
    });

    return { delegationId: delegation.id };
  });
}

async function loadForCommand(tx: Prisma.TransactionClient, delegationId: string) {
  const delegation = await tx.delegation.findUnique({
    where: { id: delegationId },
    select: {
      id: true,
      status: true,
      fromSectorId: true,
      toSectorId: true,
      requestId: true,
      maintenanceRequestId: true,
      fromSector: { select: { name: true } },
      toSector: { select: { name: true } },
      request: { select: { branchId: true, number: true, requesterId: true } },
      maintenanceRequest: { select: { branchId: true, number: true, requesterId: true } },
    },
  });

  if (!delegation) throw new NotFoundError("Etapa encaminhada");

  const branchId = delegation.request?.branchId ?? delegation.maintenanceRequest?.branchId ?? null;
  const number = delegation.request?.number ?? delegation.maintenanceRequest?.number ?? "";

  if (!branchId) throw new NotFoundError("Etapa encaminhada");

  return { ...delegation, branchId, number };
}

/** Aceita a etapa (setor de destino assume a análise). */
export async function acceptDelegation(
  context: AuthContext,
  delegationId: string,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const delegation = await loadForCommand(tx, delegationId);

    if (!context.sectorIds.includes(delegation.toSectorId)) {
      throw new BusinessRuleError("Esta etapa não é do seu setor.");
    }

    assertTransition(delegation.status, "ACCEPTED");

    await tx.delegation.update({
      where: { id: delegationId },
      data: { status: "ACCEPTED", acceptedById: context.user.id, acceptedAt: new Date() },
    });

    await tx.delegationEvent.create({
      data: {
        delegationId,
        actorId: context.user.id,
        type: "ACCEPTED",
        fromStatus: delegation.status,
        toStatus: "ACCEPTED",
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "delegation.accepted",
        entityType: "Delegation",
        entityId: delegationId,
        branchId: delegation.branchId,
        after: { status: "ACCEPTED" },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    await notify(tx, {
      type: "DELEGATION_ACCEPTED",
      actorId: context.user.id,
      branchId: delegation.branchId,
      entityType: "Delegation",
      entityId: delegationId,
      data: {
        delegationId,
        fromSectorId: delegation.fromSectorId,
        accepterName: context.user.name,
      },
    });

    return { status: "ACCEPTED" as const };
  });
}

/** Registra andamento da análise. */
export async function updateDelegationProgress(
  context: AuthContext,
  input: { delegationId: string; comment: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const delegation = await loadForCommand(tx, input.delegationId);

    if (!context.sectorIds.includes(delegation.toSectorId)) {
      throw new BusinessRuleError("Esta etapa não é do seu setor.");
    }

    assertTransition(delegation.status, "IN_PROGRESS");

    await tx.delegation.update({
      where: { id: input.delegationId },
      data: { status: "IN_PROGRESS" },
    });

    await tx.delegationEvent.create({
      data: {
        delegationId: input.delegationId,
        actorId: context.user.id,
        type: "PROGRESS_UPDATED",
        fromStatus: delegation.status,
        toStatus: "IN_PROGRESS",
        comment: input.comment,
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "delegation.progress_updated",
        entityType: "Delegation",
        entityId: input.delegationId,
        branchId: delegation.branchId,
        after: { status: "IN_PROGRESS", comment: input.comment },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return { status: "IN_PROGRESS" as const };
  });
}

/** Conclui a etapa com laudo; o comando volta para o setor de origem. */
export async function completeDelegation(
  context: AuthContext,
  input: { delegationId: string; report: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  if (input.report.trim().length < 5) {
    throw new BusinessRuleError("Descreva o laudo da análise antes de concluir a etapa.");
  }

  return prisma.$transaction(async (tx) => {
    const delegation = await loadForCommand(tx, input.delegationId);

    if (!context.sectorIds.includes(delegation.toSectorId)) {
      throw new BusinessRuleError("Esta etapa não é do seu setor.");
    }

    assertTransition(delegation.status, "COMPLETED");

    await tx.delegation.update({
      where: { id: input.delegationId },
      data: {
        status: "COMPLETED",
        report: input.report,
        completedById: context.user.id,
        completedAt: new Date(),
      },
    });

    await tx.delegationEvent.create({
      data: {
        delegationId: input.delegationId,
        actorId: context.user.id,
        type: "COMPLETED",
        fromStatus: delegation.status,
        toStatus: "COMPLETED",
        comment: input.report,
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "delegation.completed",
        entityType: "Delegation",
        entityId: input.delegationId,
        branchId: delegation.branchId,
        after: { status: "COMPLETED", report: input.report },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    await notify(tx, {
      type: "DELEGATION_COMPLETED",
      actorId: context.user.id,
      branchId: delegation.branchId,
      entityType: "Delegation",
      entityId: input.delegationId,
      data: {
        delegationId: input.delegationId,
        fromSectorId: delegation.fromSectorId,
        toSectorName: delegation.toSector.name,
        report: input.report,
      },
    });

    return { status: "COMPLETED" as const };
  });
}

/** O setor de origem encerra a etapa depois de retomar a demanda. */
export async function returnDelegation(
  context: AuthContext,
  input: { delegationId: string; comment?: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const delegation = await loadForCommand(tx, input.delegationId);

    if (!context.sectorIds.includes(delegation.fromSectorId)) {
      throw new BusinessRuleError("Somente o setor de origem pode devolver esta etapa.");
    }

    assertTransition(delegation.status, "RETURNED");

    await tx.delegation.update({
      where: { id: input.delegationId },
      data: { status: "RETURNED", returnedAt: new Date() },
    });

    await tx.delegationEvent.create({
      data: {
        delegationId: input.delegationId,
        actorId: context.user.id,
        type: "RETURNED",
        fromStatus: delegation.status,
        toStatus: "RETURNED",
        comment: input.comment,
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "delegation.returned",
        entityType: "Delegation",
        entityId: input.delegationId,
        branchId: delegation.branchId,
        after: { status: "RETURNED" },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    await notify(tx, {
      type: "DELEGATION_RETURNED",
      actorId: context.user.id,
      branchId: delegation.branchId,
      entityType: "Delegation",
      entityId: input.delegationId,
      data: {
        delegationId: input.delegationId,
        fromSectorId: delegation.fromSectorId,
        toSectorName: delegation.toSector.name,
        report: input.comment ?? null,
      },
    });

    return { status: "RETURNED" as const };
  });
}

/** Cancela a etapa antes de ser aceita. */
export async function cancelDelegation(
  context: AuthContext,
  input: { delegationId: string; reason?: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const delegation = await loadForCommand(tx, input.delegationId);

    if (!context.sectorIds.includes(delegation.fromSectorId)) {
      throw new BusinessRuleError("Somente o setor de origem pode cancelar esta etapa.");
    }

    assertTransition(delegation.status, "CANCELLED");

    await tx.delegation.update({
      where: { id: input.delegationId },
      data: { status: "CANCELLED" },
    });

    await tx.delegationEvent.create({
      data: {
        delegationId: input.delegationId,
        actorId: context.user.id,
        type: "CANCELLED",
        fromStatus: delegation.status,
        toStatus: "CANCELLED",
        comment: input.reason,
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "delegation.cancelled",
        entityType: "Delegation",
        entityId: input.delegationId,
        branchId: delegation.branchId,
        after: { status: "CANCELLED", reason: input.reason ?? null },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return { status: "CANCELLED" as const };
  });
}
