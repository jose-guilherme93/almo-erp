import type { NotificationType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { usersWithPermission } from "@/server/services/user";

const log = logger.with({ service: "notification" });

/**
 * Motor de notificação.
 *
 * Regra do projeto (AGENTS.md §3.6 e §8): notificação é **persistida no banco**
 * e criada **na mesma transação** do evento que a originou. Nunca "depois a
 * gente notifica".
 *
 * Quem recebe é resolvido em `resolveRecipients` — um único lugar, testado por
 * tipo. Se um dia notificar por e-mail ou push, entra aqui também.
 */

export type NotifyPayload = {
  type: NotificationType;
  actorId: string | null;
  branchId: string | null;
  entityType: string;
  entityId: string;
  link?: string;
  /** Dados livres para montar título e corpo. */
  data?: Record<string, string | null | undefined>;
};

/** Texto e destino de cada tipo de notificação. */
const TEMPLATES: Record<
  NotificationType,
  {
    title: (data: Record<string, string | undefined>) => string;
    body: (data: Record<string, string | undefined>) => string;
    link: (
      entityType: string,
      entityId: string,
      data: Record<string, string | undefined>,
    ) => string;
  }
> = {
  REQUEST_CREATED: {
    title: (data) => `Nova solicitação ${data["number"] ?? ""}`.trim(),
    body: (data) =>
      `${data["requesterName"] ?? "Alguém"} pediu ${data["itemCount"] ?? "itens"} de material${data["priority"] === "URGENT" ? " — URGENTE" : ""}. Abra para aprovar.`,
    link: (_entityType, _entityId, data) => `/solicitacoes/${data["requestId"] ?? ""}`,
  },
  REQUEST_CLAIMED: {
    title: (data) => `Solicitação ${data["number"] ?? ""} em análise`,
    body: (data) =>
      `${data["claimerName"] ?? "Outro aprovador"} assumiu este pedido. Ele saiu da fila.`,
    link: (_e, _i, data) => `/solicitacoes/${data["requestId"] ?? ""}`,
  },
  REQUEST_APPROVED: {
    title: (data) => `Solicitação ${data["number"] ?? ""} aprovada`,
    body: (data) =>
      `Seu pedido foi aprovado por ${data["deciderName"] ?? "um aprovador"}. Aguarde a entrega.`,
    link: (_e, _i, data) => `/solicitacoes/${data["requestId"] ?? ""}`,
  },
  REQUEST_PARTIALLY_APPROVED: {
    title: (data) => `Solicitação ${data["number"] ?? ""} aprovada parcialmente`,
    body: () => "Parte do que você pediu não foi aprovada. Veja o motivo de cada item.",
    link: (_e, _i, data) => `/solicitacoes/${data["requestId"] ?? ""}`,
  },
  REQUEST_REJECTED: {
    title: (data) => `Solicitação ${data["number"] ?? ""} rejeitada`,
    body: (data) => data["reason"] ?? "Seu pedido não foi aprovado.",
    link: (_e, _i, data) => `/solicitacoes/${data["requestId"] ?? ""}`,
  },
  REQUEST_DELIVERED: {
    title: (data) => `Solicitação ${data["number"] ?? ""} entregue`,
    body: (data) =>
      `O material foi entregue${data["receivedByName"] ? ` para ${data["receivedByName"]}` : ""}. O comprovante está disponível.`,
    link: (_e, _i, data) => `/solicitacoes/${data["requestId"] ?? ""}`,
  },
  TRANSFER_SENT: {
    title: (data) => `Transferência ${data["number"] ?? ""} a caminho`,
    body: (data) =>
      `${data["originName"] ?? "Uma unidade"} enviou material para a sua unidade. Confirme o recebimento quando chegar.`,
    link: (_e, _i, data) => `/transferencias/${data["transferId"] ?? ""}`,
  },
  TRANSFER_RECEIVED: {
    title: (data) => `Transferência ${data["number"] ?? ""} recebida`,
    body: (data) => `${data["destinationName"] ?? "A unidade de destino"} confirmou o recebimento.`,
    link: (_e, _i, data) => `/transferencias/${data["transferId"] ?? ""}`,
  },
  STOCK_BELOW_MIN: {
    title: (data) => `${data["itemName"] ?? "Material"} abaixo do mínimo`,
    body: (data) =>
      `Restam ${data["available"] ?? "0"} ${data["unitCode"] ?? ""} de ${data["itemName"] ?? "material"} (mínimo ${data["minimum"] ?? "0"}). Providencie reposição.`,
    link: (_e, _i, data) => `/catalogo/itens/${data["itemId"] ?? ""}?aba=minimos`,
  },
  INVENTORY_DIVERGENCE: {
    title: (data) => `Divergência no inventário ${data["number"] ?? ""}`,
    body: (data) =>
      `${data["divergentItems"] ?? "Alguns"} item(ns) com contagem diferente do sistema. Revise antes de ajustar.`,
    link: (_e, _i, data) => `/inventario/${data["inventoryId"] ?? ""}`,
  },
  ACCESS_REQUESTED: {
    title: () => "Pedido de acesso ao sistema",
    body: (data) => `${data["email"] ?? "Alguém"} tentou entrar e aguarda aprovação.`,
    link: () => "/admin/usuarios",
  },
  ACCESS_GRANTED: {
    title: () => "Seu acesso foi liberado",
    body: () => "Você já pode entrar no sistema com sua conta corporativa.",
    link: () => "/meu",
  },
  MAINTENANCE_CREATED: {
    title: (data) => `Novo chamado de reparo ${data["number"] ?? ""}`.trim(),
    body: (data) =>
      `${data["requesterName"] ?? "Alguém"} abriu: ${data["title"] ?? "reparo"} (${data["location"] ?? "local não informado"}). Defina a prioridade.`,
    link: (_e, _i, data) => `/reparos/${data["maintenanceId"] ?? ""}`,
  },
  MAINTENANCE_ASSIGNED: {
    title: (data) => `Chamado ${data["number"] ?? ""} atribuído a você`,
    body: () => "Você é o responsável pelo atendimento. Registre o andamento.",
    link: (_e, _i, data) => `/reparos/${data["maintenanceId"] ?? ""}`,
  },
  MAINTENANCE_PRIORITY_SET: {
    title: (data) => `Chamado ${data["number"] ?? ""} classificado`,
    body: (data) =>
      `${data["deciderName"] ?? "A manutenção"} definiu a prioridade como ${priorityLabel(data["priority"])}.`,
    link: (_e, _i, data) => `/reparos/${data["maintenanceId"] ?? ""}`,
  },
  MAINTENANCE_DONE: {
    title: (data) => `Chamado ${data["number"] ?? ""} concluído`,
    body: (data) => `${data["actorName"] ?? "A manutenção"} concluiu o reparo.`,
    link: (_e, _i, data) => `/reparos/${data["maintenanceId"] ?? ""}`,
  },
};

/** Rótulo de prioridade, para o texto da notificação. */
function priorityLabel(priority: string | undefined): string {
  const labels: Record<string, string> = {
    LOW: "baixa",
    NORMAL: "normal",
    HIGH: "alta",
    URGENT: "urgente",
  };

  return labels[priority ?? ""] ?? "não definida";
}

/**
 * Resolve quem recebe cada notificação.
 *
 * Função assíncrona porque consulta o banco (quem tem a permissão na filial).
 * Sempre exclui o autor da ação: ninguém precisa ser avisado do que fez.
 */
export async function resolveRecipients(
  payload: NotifyPayload,
  client: Prisma.TransactionClient = prisma,
): Promise<string[]> {
  const exclude = payload.actorId ? new Set([payload.actorId]) : new Set<string>();

  switch (payload.type) {
    case "REQUEST_CREATED": {
      if (!payload.branchId) return [];

      const branch = await client.branch.findUnique({
        where: { id: payload.branchId },
        select: { defaultApproverId: true, notificationResponsibleId: true },
      });

      const approvers = await usersWithPermission(payload.branchId, "solicitacao:approve");

      const recipients = new Set<string>(approvers);

      // O aprovador padrão e o responsável por notificações sempre entram,
      // mesmo que o papel deles não tenha a permissão explicitamente.
      for (const id of [branch?.defaultApproverId, branch?.notificationResponsibleId]) {
        if (id) recipients.add(id);
      }

      return [...recipients].filter((id) => !exclude.has(id));
    }

    case "REQUEST_CLAIMED": {
      if (!payload.branchId) return [];

      const approvers = await usersWithPermission(payload.branchId, "solicitacao:approve");

      return approvers.filter((id) => !exclude.has(id));
    }

    case "REQUEST_APPROVED":
    case "REQUEST_PARTIALLY_APPROVED":
    case "REQUEST_REJECTED":
    case "REQUEST_DELIVERED": {
      const recipients = new Set<string>();

      if (payload.data?.["requesterId"]) recipients.add(payload.data["requesterId"]);

      if (payload.type === "REQUEST_DELIVERED" && payload.data?.["responsibleId"]) {
        recipients.add(payload.data["responsibleId"]);
      }

      return [...recipients].filter((id) => !exclude.has(id));
    }

    case "TRANSFER_SENT": {
      if (!payload.branchId) return [];

      // Quem recebe é quem está no destino.
      const receivers = await usersWithPermission(payload.branchId, "transferencia:receber");

      return receivers.filter((id) => !exclude.has(id));
    }

    case "TRANSFER_RECEIVED": {
      if (!payload.branchId) return [];

      const senders = await usersWithPermission(payload.branchId, "transferencia:enviar");

      return senders.filter((id) => !exclude.has(id));
    }

    case "STOCK_BELOW_MIN": {
      if (!payload.branchId) return [];

      const [warehouse, admin] = await Promise.all([
        usersWithPermission(payload.branchId, "estoque:entrada"),
        usersWithPermission(payload.branchId, "estoque:ajuste"),
      ]);

      return [...new Set([...warehouse, ...admin])].filter((id) => !exclude.has(id));
    }

    case "INVENTORY_DIVERGENCE": {
      const recipients = new Set<string>();

      if (payload.branchId) {
        for (const id of await usersWithPermission(payload.branchId, "inventario:manage")) {
          recipients.add(id);
        }
      }

      // Divergência de inventário interessa à matriz também.
      const network = await client.membership.findMany({
        where: {
          active: true,
          role: { scope: "ALL_BRANCHES", active: true },
          user: { status: "ACTIVE", active: true },
        },
        select: { userId: true },
      });

      for (const membership of network) recipients.add(membership.userId);

      return [...recipients].filter((id) => !exclude.has(id));
    }

    case "ACCESS_REQUESTED": {
      const superAdmins = await client.membership.findMany({
        where: {
          active: true,
          role: { slug: "SUPER_ADMIN", active: true },
          user: { status: "ACTIVE", active: true },
        },
        select: { userId: true },
      });

      return [...new Set(superAdmins.map((membership) => membership.userId))].filter(
        (id) => !exclude.has(id),
      );
    }

    case "ACCESS_GRANTED": {
      const userId = payload.data?.["userId"];
      return userId ? [userId] : [];
    }

    case "MAINTENANCE_CREATED": {
      if (!payload.branchId) return [];

      // Quem atende manutenção na unidade + o responsável padrão.
      const [attendants, branch] = await Promise.all([
        usersWithPermission(payload.branchId, "manutencao:atender"),
        payload.branchId
          ? client.branch.findUnique({
              where: { id: payload.branchId },
              select: { notificationResponsibleId: true },
            })
          : Promise.resolve(null),
      ]);

      const recipients = new Set<string>(attendants);

      if (branch?.notificationResponsibleId) recipients.add(branch.notificationResponsibleId);

      return [...recipients].filter((id) => !exclude.has(id));
    }

    case "MAINTENANCE_ASSIGNED": {
      const assignedToId = payload.data?.["assignedToId"];
      return assignedToId && !exclude.has(assignedToId) ? [assignedToId] : [];
    }

    case "MAINTENANCE_PRIORITY_SET":
    case "MAINTENANCE_DONE": {
      const requesterId = payload.data?.["requesterId"];
      return requesterId && !exclude.has(requesterId) ? [requesterId] : [];
    }

    default:
      return [];
  }
}

/** Monta a notificação a partir do payload. */
function buildNotification(payload: NotifyPayload) {
  const template = TEMPLATES[payload.type];
  const data = payload.data ?? {};

  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(data)) {
    normalized[key] = value ?? undefined;
  }

  return {
    type: payload.type,
    title: template.title(normalized),
    body: template.body(normalized),
    link: payload.link ?? template.link(payload.entityType, payload.entityId, normalized),
  };
}

/**
 * Cria as notificações de um evento.
 *
 * Recebe o `tx` do evento para ser atômico: se a ação falhar, ninguém é
 * notificado de algo que não aconteceu.
 */
export async function notify(
  tx: Prisma.TransactionClient,
  payload: NotifyPayload,
  options: { dedupe?: boolean } = {},
): Promise<number> {
  try {
    const recipients = await resolveRecipients(payload, tx);

    if (recipients.length === 0) return 0;

    const content = buildNotification(payload);

    // Deduplicação: usada pelo alerta de mínimo, que dispara a cada
    // movimentação e seria repetitivo sem isso.
    if (options.dedupe) {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const existing = await tx.notification.findMany({
        where: {
          type: payload.type,
          entityId: payload.entityId,
          userId: { in: recipients },
          createdAt: { gte: since },
        },
        select: { userId: true },
      });

      const alreadyNotified = new Set(existing.map((notification) => notification.userId));

      const remaining = recipients.filter((id) => !alreadyNotified.has(id));

      if (remaining.length === 0) return 0;

      await tx.notification.createMany({
        data: remaining.map((userId) => ({
          userId,
          type: payload.type,
          title: content.title,
          body: content.body,
          link: content.link,
          actorId: payload.actorId,
          entityType: payload.entityType,
          entityId: payload.entityId,
          branchId: payload.branchId,
        })),
      });

      return remaining.length;
    }

    await tx.notification.createMany({
      data: recipients.map((userId) => ({
        userId,
        type: payload.type,
        title: content.title,
        body: content.body,
        link: content.link,
        actorId: payload.actorId,
        entityType: payload.entityType,
        entityId: payload.entityId,
        branchId: payload.branchId,
      })),
    });

    return recipients.length;
  } catch (error) {
    // Falha ao notificar não pode derrubar a operação do almoxarifado.
    log.error("falha ao criar notificação", {
      error,
      type: payload.type,
      entityId: payload.entityId,
    });

    return 0;
  }
}
