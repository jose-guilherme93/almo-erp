import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { requirePageNetworkScope } from "@/server/auth/guards";
import { visibleBranchIds } from "@/server/auth/scope";
import { allBranchKpis } from "@/server/services/dashboard";

export const metadata: Metadata = {
  title: "Unidades",
};

/**
 * Comparativo entre unidades.
 *
 * Serve para a matriz responder "qual unidade precisa de atenção agora" sem
 * abrir unidade por unidade.
 */
export default async function DashboardUnidadesPage() {
  const context = await requirePageNetworkScope();
  const branches = await allBranchKpis(visibleBranchIds(context));

  const totalValue = branches.reduce((total, branch) => total + Number(branch.stockValue), 0);
  const totalPending = branches.reduce((total, branch) => total + branch.pendingRequests, 0);
  const totalBelowMinimum = branches.reduce((total, branch) => total + branch.belowMinimum, 0);

  return (
    <PageBody>
      <PageHeader
        title="Visão por unidade"
        description="Comparativo operacional de toda a rede."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">
              <ArrowLeft className="size-4" />
              Voltar ao dashboard
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Unidades</CardDescription>
            <CardTitle className="text-2xl">{branches.length}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Valor consolidado</CardDescription>
            <CardTitle className="text-2xl">{formatCurrency(totalValue)}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Pendências na rede</CardDescription>
            <CardTitle className="text-2xl">
              {totalPending}
              {totalBelowMinimum > 0 ? (
                <span className="text-muted-foreground ml-2 text-sm">
                  + {totalBelowMinimum} itens abaixo do mínimo
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detalhe por unidade</CardTitle>
          <CardDescription>
            Responsável, movimentação, pendências e valor em estoque.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <caption className="sr-only">Indicadores comparativos das unidades</caption>
              <thead className="bg-muted/50">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Unidade
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Responsável pelo almoxarifado
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Itens
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Valor
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Aguardando
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Mínimo
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Último movimento
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {branches.map((branch) => (
                  <tr key={branch.branchId}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{branch.name}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{branch.code}</span>
                      {!branch.active ? (
                        <Badge variant="outline" className="ml-2">
                          inativa
                        </Badge>
                      ) : null}
                      {branch.city ? (
                        <span className="text-muted-foreground block text-xs">
                          {branch.city}/{branch.state ?? ""}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {branch.responsibleName ?? (
                        <span className="text-muted-foreground text-xs">não definido</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{branch.itemCount}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(branch.stockValue)}</td>
                    <td className="px-3 py-2 text-right">
                      {branch.pendingRequests > 0 ? (
                        <span className="font-medium">{branch.pendingRequests}</span>
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
                    <td className="text-muted-foreground px-3 py-2 text-right text-xs">
                      {branch.lastMovementAt ? formatDateTime(branch.lastMovementAt) : "nunca"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/dashboard/unidade/${branch.branchId}`}>Abrir</Link>
                      </Button>
                    </td>
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
