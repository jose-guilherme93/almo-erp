import type { Metadata } from "next";
import Link from "next/link";
import { Bell, ClipboardList, PackageSearch, Plus } from "lucide-react";

import { REQUEST_PRIORITY, REQUEST_STATUS, statusBadge } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";
import { requirePageSession } from "@/server/auth/guards";
import { dashboardRoutes, describeProfile } from "@/server/auth/home-route";
import { listMyRequests, listPendingDeliveries } from "@/server/services/request";
import { latestUnread, unreadCount } from "@/server/services/notification/inbox";

export const metadata: Metadata = {
  title: "Início",
};

/**
 * Home do usuário logado.
 *
 * Sem dado de gestão: o solicitante vê os próprios pedidos, as entregas e os
 * avisos. Quem tem dashboard vê o atalho para ele.
 */
export default async function MeuPage() {
  const context = await requirePageSession();

  const activeBranchId = context.activeBranchId;

  const [requests, unread, latest, pendingDelivery] = await Promise.all([
    listMyRequests(context, { limit: 8 }),
    unreadCount(context.user.id),
    latestUnread(context.user.id, 3),
    activeBranchId && context.hasPermission("solicitacao:entregar", activeBranchId)
      ? listPendingDeliveries(context, activeBranchId, { pageSize: 3 })
      : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 3, totalPages: 1 }),
  ]);

  const routes = dashboardRoutes(context);

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title={`Olá, ${context.user.name.split(" ")[0]}`}
        description={describeProfile(context)}
        action={
          context.hasPermission("solicitacao:create") ? (
            <Button asChild>
              <Link href="/solicitacoes/nova">
                <Plus className="size-4" />
                Solicitar material
              </Link>
            </Button>
          ) : null
        }
      />

      {unread > 0 ? (
        <Card className="border-primary/40 bg-accent/20">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div className="flex items-start gap-2">
              <Bell className="mt-0.5 size-5" aria-hidden />
              <div>
                <p className="font-medium">{unread} notificação(ões) não lida(s)</p>
                {latest[0] ? (
                  <p className="text-muted-foreground text-sm">{latest[0].title}</p>
                ) : null}
              </div>
            </div>

            <Button asChild variant="outline" size="sm">
              <Link href="/notificacoes">Ver notificações</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {routes.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {routes.map((route) => (
            <Card key={route.href} className="hover:border-primary/40 transition-colors">
              <CardHeader>
                <CardTitle className="text-base">
                  <Link href={route.href} className="hover:underline">
                    {route.label}
                  </Link>
                </CardTitle>
                <CardDescription>{route.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="size-5" aria-hidden />
            Minhas solicitações
          </CardTitle>
          <CardDescription>Os últimos pedidos que você fez.</CardDescription>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Você ainda não fez nenhum pedido de material.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {requests.map((request) => (
                <li
                  key={request.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/solicitacoes/${request.id}`}
                      className="font-mono font-medium hover:underline"
                    >
                      {request.number}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {request._count.lines} item(ns) · {request.branch.code} ·{" "}
                      {formatRelative(request.createdAt)}
                      {request.neededAt ? ` · precisa para ${formatDate(request.neededAt)}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {request.priority !== "NORMAL"
                      ? statusBadge(REQUEST_PRIORITY, request.priority)
                      : null}
                    {statusBadge(REQUEST_STATUS, request.status)}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href="/solicitacoes">Ver todas as minhas solicitações</Link>
          </Button>
        </CardContent>
      </Card>

      {pendingDelivery.total > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PackageSearch className="size-5" aria-hidden />
              Entregas aguardando você
            </CardTitle>
            <CardDescription>Solicitações aprovadas que ainda não foram separadas.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {pendingDelivery.items.map((request) => (
                <li
                  key={request.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <Link
                    href={`/entregas/${request.id}`}
                    className="font-mono font-medium hover:underline"
                  >
                    {request.number}
                  </Link>
                  <span className="text-muted-foreground text-xs">
                    {request.requester.name} · {request._count.lines} item(ns)
                  </span>
                </li>
              ))}
            </ul>

            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href="/entregas">Ver todas as entregas</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Meus acessos</CardTitle>
          <CardDescription>Unidades e perfis vinculados à sua conta.</CardDescription>
        </CardHeader>
        <CardContent>
          {context.memberships.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Você ainda não está vinculado a nenhuma unidade. Peça a um administrador para
              configurar seu acesso.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {context.memberships.map((membership) => (
                <li
                  key={`${membership.branchId}-${membership.roleSlug}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span>
                    <span className="font-medium">{membership.branchName}</span>
                    <span className="text-muted-foreground"> · {membership.branchCode}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground">{membership.roleName}</span>
                    {membership.roleScope === "ALL_BRANCHES" ? (
                      <Badge variant="outline">rede</Badge>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="text-muted-foreground mt-3 text-xs">
            Última visita: {formatDateTime(new Date())}
          </p>
        </CardContent>
      </Card>
    </PageBody>
  );
}
