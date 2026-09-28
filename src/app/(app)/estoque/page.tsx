import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownToLine, ClipboardList, PackageSearch, TriangleAlert } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDateTime, formatQuantity } from "@/lib/format";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/server/auth/guards";
import { listBelowMinimum, stockSummary } from "@/server/services/stock/alerts";

export const metadata: Metadata = {
  title: "Estoque",
};

export default async function EstoquePage() {
  const context = await requirePagePermission("estoque:read");

  const activeBranchId = context.activeBranchId;
  const scope = context.isNetworkScope ? {} : { branchIds: context.branchIds };

  const [summary, belowMinimum, todayMovements] = await Promise.all([
    stockSummary(context.isNetworkScope ? {} : { branchIds: context.branchIds }),
    listBelowMinimum({ ...scope, limit: 8 }),
    prisma.stockDocument.count({
      where: {
        status: "POSTED",
        branchId: activeBranchId ? activeBranchId : { in: context.branchIds },
        date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
  ]);

  const activeBranch = activeBranchId ? context.getMembership(activeBranchId) : undefined;

  return (
    <PageBody>
      <PageHeader
        title="Estoque"
        description={
          activeBranch
            ? `Saldos e movimentações de ${activeBranch.branchName}.`
            : "Visão consolidada de todas as unidades."
        }
        action={
          context.hasPermission("estoque:entrada") ? (
            <Button asChild>
              <Link href="/estoque/entradas/nova">
                <ArrowDownToLine className="size-4" />
                Lançar entrada
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Valor em estoque</CardDescription>
            <CardTitle className="text-2xl">{formatCurrency(summary.totalValue)}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Itens com saldo</CardDescription>
            <CardTitle className="text-2xl">{summary.totalItems}</CardTitle>
            <p className="text-muted-foreground text-xs">
              {formatQuantity(summary.totalQuantity)} em quantidade
            </p>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Reservado para solicitações</CardDescription>
            <CardTitle className="text-2xl">{formatQuantity(summary.totalReserved)}</CardTitle>
            <p className="text-muted-foreground text-xs">
              {formatQuantity(summary.totalQuantity.minus(summary.totalReserved))} disponíveis
            </p>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Abaixo do mínimo</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              {summary.belowMinimum > 0 ? (
                <TriangleAlert className="size-5 text-amber-600" aria-hidden />
              ) : null}
              {summary.belowMinimum}
            </CardTitle>
            <p className="text-muted-foreground text-xs">{todayMovements} lançamento(s) hoje</p>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reposição sugerida</CardTitle>
          <CardDescription>
            Materiais cujo saldo disponível está abaixo do mínimo definido para a unidade.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {belowMinimum.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhum item abaixo do mínimo. Nenhuma ação necessária.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {belowMinimum.map((row) => (
                <li
                  key={`${row.itemId}-${row.branchId}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/catalogo/itens/${row.itemId}?aba=estoque`}
                      className="font-medium hover:underline"
                    >
                      {row.itemName}
                    </Link>
                    <p className="text-muted-foreground font-mono text-xs">
                      {row.itemCode} · {row.branchCode}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground">
                      {formatQuantity(row.availableQuantity)} de{" "}
                      {formatQuantity(row.minimumQuantity)} {row.unitCode}
                    </span>
                    <Badge variant="outline" className="border-amber-300 text-amber-700">
                      faltam {formatQuantity(row.shortage)}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/estoque/saldos">
                <PackageSearch className="size-4" />
                Ver todos os saldos
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/estoque/movimentacoes">
                <ClipboardList className="size-4" />
                Ver movimentações
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <MovimentacoesRecentes branchIds={context.branchIds} />

      <p className="text-muted-foreground text-xs">
        Última atualização: {formatDateTime(new Date())}.
      </p>
    </PageBody>
  );
}

/** Últimos lançamentos, para conferência rápida no dia a dia. */
async function MovimentacoesRecentes({ branchIds }: { branchIds: string[] }) {
  const documents = await prisma.stockDocument.findMany({
    where: { branchId: { in: branchIds }, status: "POSTED" },
    orderBy: { date: "desc" },
    take: 8,
    select: {
      id: true,
      number: true,
      type: true,
      date: true,
      totalQuantity: true,
      totalCost: true,
      branch: { select: { code: true } },
      createdBy: { select: { name: true } },
      _count: { select: { lines: true } },
    },
  });

  if (documents.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Últimos lançamentos</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div className="min-w-0">
                <Link
                  href={`/estoque/movimentacoes/${document.id}`}
                  className="font-mono text-sm hover:underline"
                >
                  {document.number}
                </Link>
                <p className="text-muted-foreground text-xs">
                  {document.branch.code} · {document._count.lines} item(ns) ·{" "}
                  {document.createdBy.name}
                </p>
              </div>
              <span className="text-muted-foreground text-xs">
                {formatDateTime(document.date)} · {formatCurrency(document.totalCost)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
