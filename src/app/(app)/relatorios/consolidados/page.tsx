import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { buildQueryString, readPage, readPageSize, type RawSearchParams } from "@/lib/pagination";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/server/auth/guards";
import { listReportSnapshots } from "@/server/services/reports/snapshot";

export const metadata: Metadata = {
  title: "Relatórios consolidados",
};

/**
 * Histórico de relatórios consolidados.
 *
 * Cada linha é um snapshot imutável: tem hash, autor e data. Serve para provar
 * o que foi entregue e quando — e para reimprimir/baixar o mesmo conteúdo.
 */
export default async function ConsolidadosPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const context = await requirePagePermission("relatorio:read");

  const result = await listReportSnapshots(context, {
    page: readPage(params),
    pageSize: readPageSize(params),
  });

  const branchIds = [...new Set(result.items.flatMap((snapshot) => snapshot.branchIds))];
  const branches =
    branchIds.length > 0
      ? await prisma.branch.findMany({
          where: { id: { in: branchIds } },
          select: { id: true, code: true },
        })
      : [];

  const branchCode = new Map(branches.map((branch) => [branch.id, branch.code]));

  return (
    <PageBody>
      <PageHeader
        title="Relatórios consolidados"
        description="Cada consolidação é uma fotografia imutável, com hash e autor, pronta para auditar."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/relatorios">
              <ArrowLeft className="size-4" />
              Voltar aos relatórios
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="size-5" aria-hidden />
            Consolidados
          </CardTitle>
          <CardDescription>
            {result.total === 0
              ? "Nenhum relatório consolidado ainda."
              : `${result.total} relatório(s) consolidado(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {result.items.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Ao consolidar um relatório, ele aparece aqui — imutável e auditável.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Relatório
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Período
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Escopo
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Linhas
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Consolidado por
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Hash
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Saídas
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {result.items.map((snapshot) => (
                    <tr key={snapshot.id}>
                      <td className="px-3 py-2">
                        <Link
                          href={`/relatorios/consolidados/${snapshot.id}`}
                          className="font-medium hover:underline"
                        >
                          {snapshot.reportLabel}
                        </Link>
                      </td>
                      <td className="text-muted-foreground px-3 py-2 text-xs">
                        {snapshot.periodFrom.toISOString().slice(0, 10)} a{" "}
                        {snapshot.periodTo.toISOString().slice(0, 10)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {snapshot.branchIds.length === 0
                          ? "—"
                          : snapshot.branchIds.map((id) => branchCode.get(id) ?? id).join(", ")}
                      </td>
                      <td className="px-3 py-2 text-right">{snapshot.rowCount}</td>
                      <td className="px-3 py-2 text-xs">
                        {snapshot.generatedBy.name}
                        <span className="text-muted-foreground block">
                          {formatDateTime(snapshot.createdAt)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <code className="text-muted-foreground text-xs">
                          {snapshot.contentHash.slice(0, 12)}…
                        </code>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary">{snapshot._count.exports}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.totalPages > 1 ? (
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Página {result.page} de {result.totalPages}
              </span>
              <div className="flex gap-2">
                {result.page > 1 ? (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={`/relatorios/consolidados${buildQueryString(params, { pagina: result.page - 1 })}`}
                    >
                      Anterior
                    </Link>
                  </Button>
                ) : null}
                {result.page < result.totalPages ? (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={`/relatorios/consolidados${buildQueryString(params, { pagina: result.page + 1 })}`}
                    >
                      Próxima
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </PageBody>
  );
}
