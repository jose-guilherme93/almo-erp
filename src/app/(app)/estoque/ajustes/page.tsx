import type { Metadata } from "next";
import Link from "next/link";
import { Scale } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/data-table";
import { statusBadge, STOCK_DOCUMENT_STATUS } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { readPage, readPageSize, type RawSearchParams } from "@/lib/pagination";
import { requirePagePermission } from "@/server/auth/guards";
import { listStockDocuments } from "@/server/services/stock/documents";

export const metadata: Metadata = {
  title: "Ajustes",
};

type Row = Awaited<ReturnType<typeof listStockDocuments>>["items"][number];

export default async function AjustesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const context = await requirePagePermission("estoque:read");

  const result = await listStockDocuments(context, {
    type: "ADJUSTMENT",
    page: readPage(params),
    pageSize: readPageSize(params),
  });

  const columns: Array<Column<Row>> = [
    {
      key: "number",
      header: "Documento",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono font-medium">{row.number}</p>
          <p className="text-muted-foreground truncate text-xs">
            {row.storageLocationName} · {row.createdByName}
          </p>
        </div>
      ),
      mobile: (row) => row.number,
    },
    {
      key: "date",
      header: "Data",
      cell: (row) => <span className="text-sm">{formatDateTime(row.date)}</span>,
    },
    {
      key: "impact",
      header: "Impacto",
      align: "right",
      cell: (row) => (
        <span className="text-sm">
          {Number(row.totalQuantity) >= 0 ? "+" : ""}
          {formatQuantity(row.totalQuantity)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => statusBadge(STOCK_DOCUMENT_STATUS, row.status),
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title="Ajustes de estoque"
        description="Correções de saldo com justificativa registrada — quebras, perdas e acertos de contagem."
        action={
          context.hasPermission("estoque:ajuste") ? (
            <Button asChild>
              <Link href="/estoque/ajustes/novo">
                <Scale className="size-4" />
                Novo ajuste
              </Link>
            </Button>
          ) : null
        }
      />

      <p className="text-muted-foreground flex items-start gap-2 text-xs">
        <Scale className="mt-0.5 size-4 shrink-0" aria-hidden />
        Todo ajuste exige justificativa. O saldo anterior e o motivo ficam registrados na auditoria
        — a diferença entre um ajuste legítimo e um furo de controle é exatamente essa trilha.
      </p>

      <DataTable
        columns={columns}
        rows={result.items}
        getRowId={(row) => row.id}
        basePath="/estoque/ajustes"
        searchParams={params}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        rowHref={(row) => `/estoque/movimentacoes/${row.id}`}
        emptyTitle="Nenhum ajuste lançado"
        emptyDescription="Ajustes aparecem aqui quando houver divergência de contagem ou perda."
      />
    </PageBody>
  );
}
