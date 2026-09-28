import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownToLine } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/data-table";
import { statusBadge, STOCK_DOCUMENT_STATUS } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDateTime, formatQuantity } from "@/lib/format";
import { readPage, readPageSize, type RawSearchParams } from "@/lib/pagination";
import { requirePagePermission } from "@/server/auth/guards";
import { listStockDocuments } from "@/server/services/stock/documents";

export const metadata: Metadata = {
  title: "Entradas",
};

type Row = Awaited<ReturnType<typeof listStockDocuments>>["items"][number];

export default async function EntradasPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const context = await requirePagePermission("estoque:read");

  const result = await listStockDocuments(context, {
    type: "INBOUND",
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
      key: "lines",
      header: "Itens",
      align: "right",
      cell: (row) => <span className="text-sm">{row.lineCount}</span>,
    },
    {
      key: "quantity",
      header: "Quantidade",
      align: "right",
      cell: (row) => <span className="text-sm">{formatQuantity(row.totalQuantity)}</span>,
    },
    {
      key: "value",
      header: "Valor",
      align: "right",
      cell: (row) => <span className="text-sm">{formatCurrency(row.totalCost)}</span>,
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
        title="Entradas"
        description="Recebimento de material no almoxarifado, com custo e lote."
        action={
          context.hasPermission("estoque:entrada") ? (
            <Button asChild>
              <Link href="/estoque/entradas/nova">
                <ArrowDownToLine className="size-4" />
                Nova entrada
              </Link>
            </Button>
          ) : null
        }
      />

      <DataTable
        columns={columns}
        rows={result.items}
        getRowId={(row) => row.id}
        basePath="/estoque/entradas"
        searchParams={params}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        rowHref={(row) => `/estoque/movimentacoes/${row.id}`}
        emptyTitle="Nenhuma entrada lançada"
        emptyDescription="Registre o recebimento de material para formar estoque."
        emptyAction={
          context.hasPermission("estoque:entrada") ? (
            <Button asChild variant="outline">
              <Link href="/estoque/entradas/nova">Lançar entrada</Link>
            </Button>
          ) : null
        }
      />
    </PageBody>
  );
}
