import type { Prisma } from "@/generated/prisma/client";
import type { NotificationType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";

/**
 * Caixa de entrada de notificações.
 *
 * `unreadCount` é a **fonte única** do contador: o sino da barra superior e o
 * painel do dashboard chamam a mesma função, para os dois números nunca
 * divergirem (AGENTS.md §7).
 */

export async function listNotifications(
  userId: string,
  options: {
    onlyUnread?: boolean;
    type?: string | null;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));

  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(options.onlyUnread ? { readAt: null } : {}),
    ...(options.type ? { type: options.type as NotificationType } : {}),
  };

  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        link: true,
        readAt: true,
        createdAt: true,
        branch: { select: { code: true, name: true } },
        actor: { select: { name: true } },
      },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return {
    items,
    total,
    unread,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Contagem de não lidas, opcionalmente por tipo. */
export async function unreadCount(userId: string, type?: NotificationType): Promise<number> {
  return prisma.notification.count({
    where: { userId, readAt: null, ...(type ? { type } : {}) },
  });
}

/**
 * Contagem por tipo — usada pelos cards "o que precisa de você" do dashboard.
 */
export async function unreadByType(
  userId: string,
): Promise<Array<{ type: NotificationType; count: number }>> {
  const rows = await prisma.notification.groupBy({
    by: ["type"],
    where: { userId, readAt: null },
    _count: { _all: true },
  });

  return rows.map((row) => ({ type: row.type, count: row._count._all }));
}

/** Marca uma notificação como lida. Idempotente e sempre do próprio usuário. */
export async function markAsRead(userId: string, notificationId: string): Promise<void> {
  await prisma.notification.updateMany({
    // O filtro por `userId` é o que impede marcar notificação de outra pessoa.
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllAsRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });

  return result.count;
}

/** Marca como lidas as notificações de uma entidade — ao abrir a tela. */
export async function markEntityAsRead(
  userId: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, entityType, entityId, readAt: null },
    data: { readAt: new Date() },
  });
}

/** Últimas notificações não lidas, para o popover do sino. */
export async function latestUnread(userId: string, limit = 5) {
  return prisma.notification.findMany({
    where: { userId, readAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      link: true,
      createdAt: true,
    },
  });
}

/**
 * Resumo usado no topo do dashboard de quem responde pelos chamados.
 *
 * Junta o contador de não lidas com as solicitações que precisam de decisão —
 * os dois números que o aprovador precisa ver ao entrar no sistema.
 */
export async function responseInbox(
  userId: string,
  branchIds: readonly string[],
): Promise<{
  unread: number;
  pendingRequests: number;
  unreadByType: Array<{ type: NotificationType; count: number }>;
}> {
  const [unread, pendingRequests, byType] = await Promise.all([
    unreadCount(userId),
    prisma.request.count({
      where: {
        branchId: { in: [...branchIds] },
        status: { in: ["SUBMITTED", "IN_REVIEW"] },
      },
    }),
    unreadByType(userId),
  ]);

  return { unread, pendingRequests, unreadByType: byType };
}
