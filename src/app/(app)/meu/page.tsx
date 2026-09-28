import type { Metadata } from "next";
import Link from "next/link";
import { Bell, ClipboardList, PackageSearch, Plus, Wrench } from "lucide-react";

import { REQUEST_PRIORITY, REQUEST_STATUS, statusBadge } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatRelative } from "@/lib/format";
import { requirePageSession } from "@/server/auth/guards";
import { dashboardRoutes, describeProfile } from "@/server/auth/home-route";
import { listMyRequests, listPendingDeliveries } from "@/server/services/request";
import { listMaintenanceRequests } from "@/server/services/maintenance";
import {
  MAINTENANCE_STATUS_BADGE,
  MAINTENANCE_PRIORITY_BADGE,
} from "@/components/domain/status-badge";
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

  const canOpenRepair = context.hasPermission("manutencao:create");
  const canSeeRepairs = context.hasPermission("manutencao:read");

  const [requests, unread, latest, pendingDelivery, repairs] = await Promise.all([
    listMyRequests(context, { limit: 8 }),
    unreadCount(context.user.id),
    latestUnread(context.user.id, 3),
    activeBranchId && context.hasPermission("solicitacao:entregar", activeBranchId)
      ? listPendingDeliveries(context, activeBranchId, { pageSize: 3 })
      : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 3, totalPages: 1 }),
    canSeeRepairs
      ? listMaintenanceRequests(context, { mineOnly: true, pageSize: 5 })
      : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 5, totalPages: 1 }),
  ]);

  const routes = dashboardRoutes(context);

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title={`Olá, ${context.user.name.split(" ")[0]}`}
        description={describeProfile(context)}
        action={
          context.hasPermission("solicitacao:create") || canOpenRepair ? (
            <Button asChild>
              <Link href="/solicitar">
                <Plus className="size-4" />
                Fazer um pedido
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

      {repairs.items.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="size-5" aria-hidden />
              Meus chamados de reparo
            </CardTitle>
            <CardDescription>Manutenção que você pediu.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {repairs.items.map((repair) => (
                <li
                  key={repair.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{repair.title}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {repair.number} · {repair.location} · {formatRelative(repair.createdAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {repair.priority
                      ? statusBadge(MAINTENANCE_PRIORITY_BADGE, repair.priority)
                      : null}
                    {statusBadge(MAINTENANCE_STATUS_BADGE, repair.status)}
                  </div>
                </li>
              ))}
            </ul>

            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href="/reparos?meus=1">Ver todos os meus chamados</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

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
    </PageBody>
  );
}
