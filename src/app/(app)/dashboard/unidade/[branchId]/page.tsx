import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowLeftRight,
  Bell,
  ClipboardList,
  PackageSearch,
  TriangleAlert,
  Wrench,
} from "lucide-react";

import {
  MovementTrendChart,
  StockByCategoryChart,
  TopItemsChart,
} from "@/components/dashboard/charts";
import { ChartCard, MetricCard } from "@/components/dashboard/metric-card";
import { REQUEST_PRIORITY, REQUEST_STATUS, statusBadge } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatQuantity, formatRelative } from "@/lib/format";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/server/auth/guards";
import { getUnitDashboard } from "@/server/services/dashboard";
import { listApprovalQueue, listPendingDeliveries } from "@/server/services/request";
import { listBelowMinimum } from "@/server/services/stock/alerts";
import { listMaintenanceQueue, maintenanceSummary } from "@/server/services/maintenance";
import {
  MAINTENANCE_PRIORITY_BADGE,
  MAINTENANCE_STATUS_BADGE,
} from "@/components/domain/status-badge";

export const metadata: Metadata = {
  title: "Dashboard da unidade",
};

type UnitDashboardProps = {
  params: Promise<{ branchId: string }>;
};

/**
 * Dashboard da unidade.
 *
 * Esta é a mesa de trabalho de quem responde pelos chamados: o primeiro bloco
 * da tela é o que precisa de decisão agora, junto com o contador de
 * notificações não lidas.
 */
export default async function DashboardUnidadePage({ params }: UnitDashboardProps) {
  const { branchId } = await params;

  // Exclusivo do admin da unidade (e da matriz, em leitura).
  const context = await requirePagePermission("solicitacao:approve", branchId);

  if (!context.branchIds.includes(branchId)) notFound();

  const branch = await prisma.branch.findFirst({
    where: { id: branchId },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      city: true,
      state: true,
      active: true,
      warehouseResponsible: { select: { name: true } },
      defaultApprover: { select: { name: true } },
    },
  });

  if (!branch) notFound();

  const [dashboard, queue, deliveries, belowMinimum, repairQueue, repairs] = await Promise.all([
    getUnitDashboard(context, branchId),
    listApprovalQueue(context, branchId, { pageSize: 5 }),
    listPendingDeliveries(context, branchId, { pageSize: 5 }),
    listBelowMinimum({ branchId, limit: 5 }),
    context.hasPermission("manutencao:read", branchId)
      ? listMaintenanceQueue(context, branchId, { pageSize: 5 })
      : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 5, totalPages: 1 }),
    context.hasPermission("manutencao:read", branchId)
      ? maintenanceSummary([branchId])
      : Promise.resolve(null),
  ]);

  const unread = dashboard.inbox.unread;

  return (
    <PageBody>
      <PageHeader
        title={branch.name}
        description={`${branch.code}${branch.city ? ` · ${branch.city}/${branch.state ?? ""}` : ""}${
          branch.warehouseResponsible ? ` · almoxarifado: ${branch.warehouseResponsible.name}` : ""
        }`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/notificacoes">
                <Bell className="size-4" />
                Notificações
                {unread > 0 ? (
                  <Badge variant="destructive" className="ml-1">
                    {unread}
                  </Badge>
                ) : null}
              </Link>
            </Button>

            {context.isNetworkScope ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/dashboard/unidades">
                  <ArrowLeft className="size-4" />
                  Todas as unidades
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      {/* Bloco de alertas: o que precisa de resposta agora. */}
      <Card className={dashboard.pendingRequests > 0 ? "border-amber-300" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="size-5" aria-hidden />
            Precisa da sua resposta
          </CardTitle>
          <CardDescription>
            {dashboard.pendingRequests === 0
              ? "Nenhuma solicitação aguardando decisão."
              : `${dashboard.pendingRequests} solicitação(ões) aguardando aprovação${
                  dashboard.requestsAtRisk > 0 ? ` · ${dashboard.requestsAtRisk} acima de 24h` : ""
                }.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {queue.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Quando alguém da unidade pedir material, o chamado aparece aqui e no sino.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {queue.items.map((request) => (
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
                      {request.requester.name} · {request._count.lines} item(ns) ·{" "}
                      {formatRelative(request.createdAt)}
                      {request.claimedBy ? ` · em análise com ${request.claimedBy.name}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {statusBadge(REQUEST_PRIORITY, request.priority)}
                    {statusBadge(REQUEST_STATUS, request.status)}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {queue.total > queue.items.length ? (
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href="/solicitacoes/fila">Ver a fila completa ({queue.total})</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Notificações não lidas"
          value={unread}
          tone={unread > 0 ? "warning" : "neutral"}
          href="/notificacoes"
          icon={<Bell className="size-3.5" />}
        />

        <MetricCard
          title="Aguardando entrega"
          value={dashboard.awaitingDelivery}
          hint="aprovadas para separar"
          href="/entregas"
          icon={<PackageSearch className="size-3.5" />}
        />

        <MetricCard
          title="Transferências a receber"
          value={dashboard.transfersInTransit}
          hint="a caminho desta unidade"
          href="/transferencias?sentido=incoming"
          icon={<ArrowLeftRight className="size-3.5" />}
        />

        <MetricCard
          title="Itens abaixo do mínimo"
          value={dashboard.belowMinimum}
          tone={dashboard.belowMinimum > 0 ? "warning" : "success"}
          hint="providencie reposição"
          icon={<TriangleAlert className="size-3.5" />}
        />

        <MetricCard
          title="Valor em estoque"
          value={formatCurrency(dashboard.stockValue)}
          hint={`${dashboard.totalItems} item(ns) com saldo`}
          href="/estoque/saldos"
        />

        <MetricCard
          title="Quantidade em estoque"
          value={formatQuantity(dashboard.totalQuantity)}
          hint={`${formatQuantity(dashboard.totalReserved)} reservados`}
        />

        <MetricCard
          title="Solicitações abertas"
          value={dashboard.requestsByStatus.reduce(
            (total, entry) =>
              [
                "SUBMITTED",
                "IN_REVIEW",
                "APPROVED",
                "PARTIALLY_APPROVED",
                "IN_PREPARATION",
              ].includes(entry.status)
                ? total + entry.count
                : total,
            0,
          )}
          hint="em andamento nesta unidade"
          href="/solicitacoes?minhas=0"
        />

        <MetricCard
          title="Fila de aprovação"
          value={queue.total}
          tone={queue.total > 0 ? "warning" : "success"}
          href="/solicitacoes/fila"
        />

        {repairs ? (
          <MetricCard
            title="Reparos em aberto"
            value={repairs.open}
            tone={repairs.withoutPriority > 0 ? "warning" : "neutral"}
            hint={
              repairs.withoutPriority > 0
                ? `${repairs.withoutPriority} sem prioridade`
                : "todos classificados"
            }
            href="/reparos"
            icon={<Wrench className="size-3.5" />}
          />
        ) : null}
      </div>

      {repairQueue.total > 0 ? (
        <Card className={repairs && repairs.withoutPriority > 0 ? "border-amber-300" : undefined}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="size-5" aria-hidden />
              Chamados de reparo
            </CardTitle>
            <CardDescription>
              {repairs && repairs.withoutPriority > 0
                ? `${repairs.withoutPriority} sem prioridade definida — quem recebe é que classifica.`
                : `${repairQueue.total} chamado(s) em aberto nesta unidade.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {repairQueue.items.map((repair) => (
                <li
                  key={repair.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/reparos/${repair.id}`}
                      className="block truncate font-medium hover:underline"
                    >
                      {repair.title}
                    </Link>
                    <p className="text-muted-foreground truncate text-xs">
                      {repair.number} · {repair.location} · {repair.requester.name} ·{" "}
                      {formatRelative(repair.createdAt)}
                      {repair.assignedTo ? ` · com ${repair.assignedTo.name}` : ""}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {repair.priority ? (
                      statusBadge(MAINTENANCE_PRIORITY_BADGE, repair.priority)
                    ) : (
                      <Badge variant="outline" className="border-amber-300 text-amber-700">
                        a classificar
                      </Badge>
                    )}
                    {statusBadge(MAINTENANCE_STATUS_BADGE, repair.status)}
                  </div>
                </li>
              ))}
            </ul>

            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href="/reparos">Ver todos os chamados ({repairQueue.total})</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {deliveries.items.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Prontas para entregar</CardTitle>
            <CardDescription>Separe o material e registre a retirada.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {deliveries.items.map((request) => (
                <li
                  key={request.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/entregas/${request.id}`}
                      className="font-mono font-medium hover:underline"
                    >
                      {request.number}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {request.requester.name} · {request._count.lines} item(ns)
                    </p>
                  </div>
                  {statusBadge(REQUEST_STATUS, request.status)}
                </li>
              ))}
            </ul>

            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href="/entregas">Ver todas as entregas</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {belowMinimum.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Reposição sugerida</CardTitle>
            <CardDescription>Itens que cruzaram o mínimo desta unidade.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {belowMinimum.map((row) => (
                <li
                  key={row.itemId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/catalogo/itens/${row.itemId}?aba=estoque`}
                      className="font-medium hover:underline"
                    >
                      {row.itemName}
                    </Link>
                    <p className="text-muted-foreground font-mono text-xs">{row.itemCode}</p>
                  </div>

                  <span className="text-muted-foreground text-sm">
                    {formatQuantity(row.availableQuantity)} de {formatQuantity(row.minimumQuantity)}{" "}
                    {row.unitCode}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Entradas e saídas" description="Movimentação semanal desta unidade.">
          <MovementTrendChart data={dashboard.movementTrend} />
        </ChartCard>

        <ChartCard title="Valor por categoria" description="Composição do estoque da unidade.">
          <StockByCategoryChart data={dashboard.stockByCategory} />
        </ChartCard>

        <div className="lg:col-span-2">
          <ChartCard title="Materiais mais consumidos" description="Saídas dos últimos 30 dias.">
            <TopItemsChart
              data={dashboard.topConsumedItems.map((item) => ({
                name: item.name,
                quantity: item.quantity,
                unitCode: item.unitCode,
              }))}
            />
          </ChartCard>
        </div>
      </div>
    </PageBody>
  );
}
