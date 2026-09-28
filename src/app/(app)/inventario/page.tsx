import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/data-table";
import { ClearFilters, TableFilterSelect } from "@/components/data-table/table-filters";
import { statusBadge, INVENTORY_STATUS } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { firstParam, readPage, readPageSize, type RawSearchParams } from "@/lib/pagination";
import { requirePagePermission } from "@/server/auth/guards";
import { resolveWorkingBranch } from "@/server/auth/scope";
import { listInventorySessions } from "@/server/services/inventory";

export const metadata: Metadata = {
  title: "Inventário",
};

type Row = Awaited<ReturnType<typeof listInventorySessions>>["items"][number];

export default async function InventarioPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const context = await requirePagePermission("inventario:read");
  const branchId = resolveWorkingBranch(context, null);

  const result = await listInventorySessions(context, branchId, {
    status: firstParam(params, "situacao") ?? null,
    page: readPage(params),
    pageSize: readPageSize(params),
  });

  const columns: Array<Column<Row>> = [
    {
      key: "number",
      header: "Inventário",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono font-medium">{row.number}</p>
          <p className="text-muted-foreground truncate text-xs">
            {row._count.lines} item(ns) · {row.createdBy.name}
          </p>
        </div>
      ),
      mobile: (row) => row.number,
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => statusBadge(INVENTORY_STATUS, row.status),
    },
    {
      key: "startedAt",
      header: "Iniciado em",
      cell: (row) => (
        <span className="text-muted-foreground text-sm">
          {row.startedAt ? formatDateTime(row.startedAt) : "—"}
        </span>
      ),
    },
    {
      key: "closedAt",
      header: "Encerrado em",
      cell: (row) => (
        <span className="text-muted-foreground text-sm">
          {row.closedAt ? formatDateTime(row.closedAt) : "—"}
        </span>
      ),
    },
    {
      key: "closedBy",
      header: "Encerrado por",
      cell: (row) => <span className="text-sm">{row.closedBy?.name ?? "—"}</span>,
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title="Inventário"
        description="Contagem física, apuração de divergência e ajuste do saldo."
        action={
          context.hasPermission("inventario:manage") ? (
            <Button asChild>
              <Link href="/inventario/nova">
                <Plus className="size-4" />
                Novo inventário
              </Link>
            </Button>
          ) : null
        }
      />

      <p className="text-muted-foreground text-xs">
        A contagem congela o saldo do sistema no momento da abertura. O estoque só muda quando o
        ajuste é aplicado — e cada divergência exige justificativa.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <TableFilterSelect
          paramKey="situacao"
          placeholder="Situação"
          allLabel="Todas as situações"
          options={Object.entries(INVENTORY_STATUS).map(([value, descriptor]) => ({
            value,
            label: descriptor.label,
          }))}
        />

        <ClearFilters paramKeys={["situacao"]} />
      </div>

      <DataTable
        columns={columns}
        rows={result.items}
        getRowId={(row) => row.id}
        basePath="/inventario"
        searchParams={params}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        rowHref={(row) => `/inventario/${row.id}`}
        emptyTitle="Nenhum inventário registrado"
        emptyDescription="Abra um inventário para conferir o estoque físico contra o sistema."
        emptyAction={
          context.hasPermission("inventario:manage") ? (
            <Button asChild variant="outline">
              <Link href="/inventario/nova">Abrir inventário</Link>
            </Button>
          ) : null
        }
      />
    </PageBody>
  );
}
