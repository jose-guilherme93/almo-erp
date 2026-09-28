import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, type Column } from "@/components/data-table/data-table";
import {
  ClearFilters,
  TableFilterSelect,
  TableSearch,
} from "@/components/data-table/table-filters";
import { statusBadge, STOCK_DOCUMENT_TYPE } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDateTime, formatQuantity } from "@/lib/format";
import { firstParam, readPage, readPageSize, type RawSearchParams } from "@/lib/pagination";
import { requirePagePermission } from "@/server/auth/guards";
import { listStockDocuments } from "@/server/services/stock/documents";

export const metadata: Metadata = {
  title: "Movimentações",
};

type Row = Awaited<ReturnType<typeof listStockDocuments>>["items"][number];

type MovimentacoesPageProps = {
  searchParams: Promise<RawSearchParams>;
};

const TYPE_OPTIONS = Object.entries(STOCK_DOCUMENT_TYPE).map(([value, descriptor]) => ({
  value,
  label: descriptor.label,
}));

export default async function MovimentacoesPage({ searchParams }: MovimentacoesPageProps) {
  const params = await searchParams;
  const context = await requirePagePermission("estoque:read");

  const page = readPage(params);
  const pageSize = readPageSize(params);
  const type = firstParam(params, "tipo") ?? null;
  const status = firstParam(params, "situacao") ?? null;
  const from = firstParam(params, "de") ?? null;
  const to = firstParam(params, "ate") ?? null;

  const result = await listStockDocuments(context, { type, status, from, to, page, pageSize });

  const columns: Array<Column<Row>> = [
    {
      key: "number",
      header: "Documento",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono font-medium">{row.number}</p>
          <p className="text-muted-foreground truncate text-xs">
            {row.branchCode} · {row.storageLocationName}
          </p>
        </div>
      ),
      mobile: (row) => row.number,
    },
    {
      key: "type",
      header: "Tipo",
      cell: (row) => statusBadge(STOCK_DOCUMENT_TYPE, row.type),
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
      key: "author",
      header: "Responsável",
      cell: (row) => <span className="text-sm">{row.createdByName}</span>,
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (
        <Badge variant={row.status === "POSTED" ? "secondary" : "outline"}>
          {row.status === "POSTED"
            ? "Lançado"
            : row.status === "CANCELLED"
              ? "Cancelado"
              : "Rascunho"}
        </Badge>
      ),
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title="Movimentações"
        description="Extrato de tudo que entrou e saiu do estoque, com quem lançou."
        action={
          context.hasPermission("estoque:entrada") ? (
            <Button asChild variant="outline">
              <Link href="/estoque/entradas/nova">Lançar entrada</Link>
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <TableSearch paramKey="busca" placeholder="Buscar por número…" />

        <TableFilterSelect
          paramKey="tipo"
          placeholder="Tipo"
          allLabel="Todos os tipos"
          options={TYPE_OPTIONS}
        />

        <TableFilterSelect
          paramKey="situacao"
          placeholder="Situação"
          allLabel="Todas as situações"
          options={[
            { value: "POSTED", label: "Lançadas" },
            { value: "CANCELLED", label: "Canceladas" },
          ]}
        />

        <ClearFilters paramKeys={["busca", "tipo", "situacao", "de", "ate"]} />
      </div>

      <DataTable
        columns={columns}
        rows={result.items}
        getRowId={(row) => row.id}
        basePath="/estoque/movimentacoes"
        searchParams={params}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        rowHref={(row) => `/estoque/movimentacoes/${row.id}`}
        emptyTitle="Nenhuma movimentação encontrada"
        emptyDescription={
          type || status || from || to
            ? "Ajuste os filtros para ver mais resultados."
            : "Nenhuma entrada ou saída registrada nesta unidade ainda."
        }
      />
    </PageBody>
  );
}
