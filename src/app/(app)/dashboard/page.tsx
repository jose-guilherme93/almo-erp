import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeftRight,
  Building2,
  ClipboardList,
  PackageSearch,
  Timer,
  TriangleAlert,
} from "lucide-react";

import {
  MovementTrendChart,
  StockByCategoryChart,
  StockValueByBranchChart,
  TopItemsChart,
} from "@/components/dashboard/charts";
import { ChartCard, MetricCard } from "@/components/dashboard/metric-card";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDuration, formatQuantity } from "@/lib/format";
import { requirePageNetworkScope } from "@/server/auth/guards";
import { allBranchKpis, getMatrixDashboard } from "@/server/services/dashboard";
import { visibleBranchIds } from "@/server/auth/scope";

export const metadata: Metadata = {
  title: "Dashboard da matriz",
};

/**
 * Dashboard da matriz.
 *
 * Audiência: SUPER_ADMIN e ADMIN_MATRIZ. Mostra a rede inteira — nenhuma
 * unidade isolada aqui (isso é o dashboard da unidade).
 */
export default async function DashboardMatrizPage() {
  const context = await requirePageNetworkScope();

  const [dashboard, branches] = await Promise.all([
    getMatrixDashboard(context),
    allBranchKpis(visibleBranchIds(context)),
  ]);

  const atRisk = dashboard.requestsAtRisk;

  return (
    <PageBody>
      <PageHeader
        title="Dashboard da matriz"
        description={`Consolidado de ${dashboard.branchCount} unidade(s) ativa(s).`}
        action={
          <Button asChild variant="outline">
            <Link href="/dashboard/unidades">
              <Building2 className="size-4" />
              Comparar unidades
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Valor total em estoque"
          value={formatCurrency(dashboard.stockValue)}
          hint={`${dashboard.totalItems} item(ns) com saldo`}
          href="/estoque/saldos"
        />

        <MetricCard
          title="Solicitações aguardando decisão"
          value={dashboard.pendingRequests}
          tone={dashboard.pendingRequests > 0 ? "warning" : "neutral"}
          hint={atRisk > 0 ? `${atRisk} acima de 24h` : "nenhuma acima do prazo"}
          href="/solicitacoes/fila"
          icon={<ClipboardList className="size-3.5" />}
        />

        <MetricCard
          title="Prontas para entregar"
          value={dashboard.awaitingDelivery}
          hint="aprovadas aguardando retirada"
          href="/entregas"
          icon={<PackageSearch className="size-3.5" />}
        />

        <MetricCard
          title="Transferências em trânsito"
          value={dashboard.transfersInTransit}
          hint="material fora das unidades"
          href="/transferencias?sentido=all"
          icon={<ArrowLeftRight className="size-3.5" />}
        />

        <MetricCard
          title="Itens abaixo do mínimo"
          value={dashboard.belowMinimum}
          tone={dashboard.belowMinimum > 0 ? "warning" : "success"}
          hint="em toda a rede"
          icon={<TriangleAlert className="size-3.5" />}
        />

        <MetricCard
          title="Tempo médio de aprovação"
          value={
            dashboard.averageApprovalHours === null
              ? "—"
              : formatDuration(dashboard.averageApprovalHours)
          }
          hint="últimos 90 dias"
          icon={<Timer className="size-3.5" />}
        />

        <MetricCard
          title="Reservado para pedidos"
          value={formatQuantity(dashboard.totalReserved)}
          hint={`de ${formatQuantity(dashboard.totalQuantity)} em estoque`}
        />

        <MetricCard
          title="Unidades com pendência"
          value={branches.filter((branch) => branch.pendingRequests > 0).length}
          hint={`de ${branches.length} unidade(s)`}
          href="/dashboard/unidades"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Entradas e saídas"
          description="Quantidade movimentada por semana, últimos 3 meses."
        >
          <MovementTrendChart data={dashboard.movementTrend} />
        </ChartCard>

        <ChartCard
          title="Valor de estoque por unidade"
          description="Onde está o capital parado na rede."
        >
          <StockValueByBranchChart data={dashboard.stockValueByBranch} />
        </ChartCard>

        <ChartCard
          title="Top materiais por consumo"
          description="Quantidade que saiu nos últimos 30 dias."
        >
          <TopItemsChart
            data={dashboard.topConsumedItems.map((item) => ({
              name: item.name,
              quantity: item.quantity,
              unitCode: item.unitCode,
            }))}
          />
        </ChartCard>

        <ChartCard title="Valor por categoria" description="Distribuição do estoque da rede.">
          <StockByCategoryChart data={dashboard.stockByCategory} />
        </ChartCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pendências por unidade</CardTitle>
          <CardDescription>
            O que precisa de atenção agora. Clique na unidade para abrir o dashboard dela.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Unidade
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Aguardando
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Acima de 24h
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Abaixo do mínimo
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    A receber
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Valor em estoque
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {branches.map((branch) => (
                  <tr key={branch.branchId}>
                    <td className="px-3 py-2">
                      <Link
                        href={`/dashboard/unidade/${branch.branchId}`}
                        className="font-medium hover:underline"
                      >
                        {branch.name}
                      </Link>
                      <span className="text-muted-foreground ml-2 text-xs">
                        {branch.code}
                        {branch.city ? ` · ${branch.city}/${branch.state ?? ""}` : ""}
                      </span>
                      {!branch.active ? (
                        <Badge variant="outline" className="ml-2">
                          inativa
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {branch.pendingRequests > 0 ? (
                        <span className="font-medium">{branch.pendingRequests}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {branch.atRisk > 0 ? (
                        <Badge variant="outline" className="border-amber-300 text-amber-700">
                          {branch.atRisk}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {branch.belowMinimum > 0 ? (
                        <Badge variant="outline" className="border-amber-300 text-amber-700">
                          {branch.belowMinimum}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {branch.incomingTransfers > 0 ? (
                        branch.incomingTransfers
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{formatCurrency(branch.stockValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </PageBody>
  );
}
