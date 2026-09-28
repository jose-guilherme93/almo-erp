import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileSpreadsheet } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PERIOD_PRESETS, resolvePreset } from "@/lib/csv";
import { firstParam, type RawSearchParams } from "@/lib/pagination";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/server/auth/guards";
import {
  REPORTS,
  buildScope,
  isReportId,
  reportSupportsCategory,
  runReport,
} from "@/server/services/reports";

export const metadata: Metadata = {
  title: "Relatórios",
};

const DEFAULT_REPORT = "consumo-material";

/**
 * Central de relatórios.
 *
 * Um relatório por vez, escolhido na URL: a mesma consulta alimenta a tabela e
 * o botão de exportar CSV (AGENTS.md §12.2).
 */
export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const context = await requirePagePermission("relatorio:read");

  const requested = firstParam(params, "relatorio") ?? DEFAULT_REPORT;
  const reportId = isReportId(requested) ? requested : DEFAULT_REPORT;

  // O preset de período tem precedência sobre as datas soltas: quem clica em
  // "mês atual" espera exatamente isso.
  const presetId = firstParam(params, "periodo");
  const preset = PERIOD_PRESETS.find((entry) => entry.id === presetId);
  const presetPeriod = preset ? resolvePreset(preset.id) : null;

  const scope = buildScope(context, {
    from: presetPeriod?.from ?? firstParam(params, "de") ?? null,
    to: presetPeriod?.to ?? firstParam(params, "ate") ?? null,
    branchId: firstParam(params, "filial") ?? null,
    categoryId: firstParam(params, "categoria") ?? null,
  });

  const [result, branches, categories] = await Promise.all([
    runReport(reportId, scope),
    prisma.branch.findMany({
      where: { id: { in: context.branchIds } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    reportSupportsCategory(reportId)
      ? prisma.category.findMany({
          where: { active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const report = REPORTS.find((entry) => entry.id === reportId);
  const from = scope.from.toISOString().slice(0, 10);
  const to = scope.to.toISOString().slice(0, 10);

  const activePreset = firstParam(params, "periodo") ?? "";

  const exportQuery = new URLSearchParams({
    de: from,
    ate: to,
    ...(firstParam(params, "filial") ? { filial: firstParam(params, "filial") as string } : {}),
    ...(firstParam(params, "categoria")
      ? { categoria: firstParam(params, "categoria") as string }
      : {}),
  });

  return (
    <PageBody>
      <PageHeader
        title="Relatórios"
        description="Consumo, cobertura de estoque, valor e auditoria das movimentações."
        action={
          <Button asChild variant="outline">
            <Link
              href={`/api/relatorios/${reportId}/csv?${exportQuery.toString()}`}
              prefetch={false}
            >
              <Download className="size-4" />
              Exportar CSV
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-1 border-b pb-2">
        {REPORTS.map((entry) => (
          <Link
            key={entry.id}
            href={`/relatorios?relatorio=${entry.id}`}
            aria-current={reportId === entry.id ? "page" : undefined}
            className={
              reportId === entry.id
                ? "bg-accent text-accent-foreground rounded-md px-3 py-1.5 text-sm font-medium"
                : "text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-sm"
            }
          >
            {entry.label}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{report?.label}</CardTitle>
          <CardDescription>
            {report?.description} Período de {from} a {to}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Filtros em GET: a URL vira o link compartilhável do relatório. */}
          <form method="get" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="relatorio" value={reportId} />

            <div className="space-y-1">
              <label htmlFor="de" className="text-xs font-medium">
                De
              </label>
              <Input id="de" name="de" type="date" defaultValue={from} className="w-40" />
            </div>

            <div className="space-y-1">
              <label htmlFor="ate" className="text-xs font-medium">
                Até
              </label>
              <Input id="ate" name="ate" type="date" defaultValue={to} className="w-40" />
            </div>

            <div className="space-y-1">
              <label htmlFor="filial" className="text-xs font-medium">
                Unidade
              </label>
              <Select name="filial" defaultValue={firstParam(params, "filial") ?? "todas"}>
                <SelectTrigger id="filial" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as unidades</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.code} — {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {categories.length > 0 ? (
              <div className="space-y-1">
                <label htmlFor="categoria" className="text-xs font-medium">
                  Categoria
                </label>
                <Select name="categoria" defaultValue={firstParam(params, "categoria") ?? "todas"}>
                  <SelectTrigger id="categoria" className="w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas as categorias</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <Button type="submit" variant="outline">
              Aplicar
            </Button>
          </form>

          <div className="mt-3 flex flex-wrap gap-1">
            {PERIOD_PRESETS.map((preset) => (
              <Link
                key={preset.id}
                href={`/relatorios?relatorio=${reportId}&periodo=${preset.id}${
                  firstParam(params, "filial") ? `&filial=${firstParam(params, "filial")}` : ""
                }${firstParam(params, "categoria") ? `&categoria=${firstParam(params, "categoria")}` : ""}`}
                aria-current={activePreset === preset.id ? "page" : undefined}
                className={
                  activePreset === preset.id
                    ? "bg-accent text-accent-foreground rounded px-2 py-1 text-xs"
                    : "text-muted-foreground hover:bg-accent/50 rounded px-2 py-1 text-xs"
                }
              >
                {preset.label}
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5" aria-hidden />
            Resultado
          </CardTitle>
          <CardDescription>{result.summary}</CardDescription>
        </CardHeader>
        <CardContent>
          {result.rows.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              Nenhum dado no período e escopo selecionados.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {result.headers.map((header) => (
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
                  {result.rows.slice(0, 100).map((row, index) => (
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

          {result.rows.length > 100 ? (
            <p className="text-muted-foreground mt-2 text-xs">
              Mostrando as 100 primeiras linhas. Use o CSV para o conjunto completo.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </PageBody>
  );
}
