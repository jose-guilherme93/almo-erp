import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Lock } from "lucide-react";

import { DriveExportButton } from "@/components/domain/report-drive-button";
import { PrintButton } from "@/components/domain/report-print";
import { SuccessCallout, successMessageFrom } from "@/components/domain/success-callout";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_NAME } from "@/lib/constants";
import { env } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import type { RawSearchParams } from "@/lib/pagination";
import { requirePagePermission } from "@/server/auth/guards";
import { branchCodesFor, getReportSnapshot } from "@/server/services/reports/snapshot";

export const metadata: Metadata = {
  title: "Relatório consolidado",
};

const EXPORT_LABELS: Record<string, string> = {
  CSV: "CSV",
  PDF: "PDF",
  PRINT: "Impressão / PDF",
  DRIVE: "Google Drive",
};

/**
 * Relatório consolidado (fotografia imutável).
 *
 * Os dados vêm do snapshot — nunca de uma nova consulta ao banco. É a prova de
 * que o que foi entregue não muda: o hash fecha o conteúdo.
 */
export default async function ConsolidadoDetalhePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const context = await requirePagePermission("relatorio:read");

  let snapshot: Awaited<ReturnType<typeof getReportSnapshot>>;

  try {
    snapshot = await getReportSnapshot(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const headers = snapshot.headers as string[];
  const rows = snapshot.rows as Array<Array<string | number | null>>;
  const branchCodes = await branchCodesFor(snapshot.branchIds);

  const from = snapshot.periodFrom.toISOString().slice(0, 10);
  const to = snapshot.periodTo.toISOString().slice(0, 10);
  const csvHref = `/api/relatorios/consolidados/${snapshot.id}/csv`;

  const successMessage = successMessageFrom(query, {
    consolidado:
      "Relatório consolidado e imutável. Use Imprimir / Salvar PDF para gerar o arquivo ou envie ao Google Drive.",
  });

  return (
    <PageBody className="max-w-5xl">
      {successMessage ? <SuccessCallout message={successMessage} /> : null}

      <PageHeader
        title={snapshot.reportLabel}
        description={`Relatório consolidado em ${formatDateTime(snapshot.createdAt)}`}
        action={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button asChild variant="ghost" size="sm">
              <Link href="/relatorios/consolidados">
                <ArrowLeft className="size-4" />
                Consolidados
              </Link>
            </Button>
            <PrintButton />
            <Button asChild variant="outline">
              <Link href={csvHref} prefetch={false}>
                <Download className="size-4" />
                Baixar CSV
              </Link>
            </Button>
            <DriveExportButton
              snapshotId={snapshot.id}
              reportId={snapshot.reportId}
              from={from}
              to={to}
              csvHref={csvHref}
              clientId={env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? null}
            />
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="size-5" aria-hidden />
            {APP_NAME} — {snapshot.reportLabel}
          </CardTitle>
          <CardDescription>{snapshot.summary}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-xs">Período</dt>
              <dd>
                {from} a {to}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Unidades</dt>
              <dd>{branchCodes.length === 0 ? "Todas" : branchCodes.join(", ")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Linhas</dt>
              <dd>{snapshot.rowCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Consolidado por</dt>
              <dd>
                {snapshot.generatedBy.name}
                <span className="text-muted-foreground block text-xs">
                  {snapshot.generatedBy.email}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Consolidado em</dt>
              <dd>{formatDateTime(snapshot.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Hash (SHA-256)</dt>
              <dd>
                <code className="text-xs break-all">{snapshot.contentHash}</code>
              </dd>
            </div>
          </dl>

          {rows.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Este relatório foi consolidado sem linhas no período e escopo.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {headers.map((header) => (
                      <th
                        key={header}
                        scope="col"
                        className="px-3 py-2 text-left font-medium whitespace-nowrap"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row, index) => (
                    <tr key={index}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="px-3 py-2 whitespace-nowrap">
                          {cell === null || cell === undefined ? "—" : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Histórico de exportações</CardTitle>
          <CardDescription>
            Quem exportou, em que formato e quando. Registro append-only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {snapshot.exports.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma saída registrada.</p>
          ) : (
            <ul className="divide-y text-sm">
              {snapshot.exports.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span>
                    <Badge variant="secondary">{EXPORT_LABELS[entry.format] ?? entry.format}</Badge>{" "}
                    <span className="text-muted-foreground">
                      por {entry.actor.name} · {formatDateTime(entry.createdAt)}
                    </span>
                  </span>
                  {entry.destinationUrl ? (
                    <a
                      href={entry.destinationUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-xs underline"
                    >
                      {entry.destination ?? "Abrir"}
                    </a>
                  ) : entry.destination ? (
                    <span className="text-muted-foreground text-xs">{entry.destination}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageBody>
  );
}
