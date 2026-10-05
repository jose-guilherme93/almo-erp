import type { Metadata } from "next";
import Link from "next/link";
import { PackageCheck } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/data-table";
import { ClearFilters, TableFilterSelect } from "@/components/data-table/table-filters";
import { REQUEST_PRIORITY, REQUEST_STATUS, statusBadge } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/format";
import { firstParam, readPage, readPageSize, type RawSearchParams } from "@/lib/pagination";
import { requirePagePermission } from "@/server/auth/guards";
import { readRequestedBranchId } from "@/server/auth/scope";
import { listPendingDeliveries, listRequestableBranches } from "@/server/services/request";

export const metadata: Metadata = {
  title: "Entregas",
};

type Row = Awaited<ReturnType<typeof listPendingDeliveries>>["items"][number];

export default async function EntregasPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const context = await requirePagePermission("solicitacao:entregar");

  const showBranchFilter = context.isNetworkScope;
  const branchId = readRequestedBranchId(context, firstParam(params, "filial"));

  const [result, branches] = await Promise.all([
    listPendingDeliveries(context, branchId, {
      page: readPage(params),
      pageSize: readPageSize(params),
    }),
    showBranchFilter ? listRequestableBranches(context) : Promise.resolve([]),
  ]);

  const columns: Array<Column<Row>> = [
    {
      key: "number",
      header: "Solicitação",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono font-medium">{row.number}</p>
          <p className="text-muted-foreground truncate text-xs">
            {row.requester.name}
            {showBranchFilter ? ` · ${row.branch.code}` : ""} · {row._count.lines} item(ns)
          </p>
        </div>
      ),
      mobile: (row) => row.number,
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => statusBadge(REQUEST_STATUS, row.status),
    },
    {
      key: "priority",
      header: "Prioridade",
      cell: (row) => statusBadge(REQUEST_PRIORITY, row.priority),
    },
    {
      key: "waiting",
      header: "Aprovada há",
      align: "right",
      cell: (row) => (
        <span className="text-muted-foreground text-sm">
          {row.decidedAt ? formatRelative(row.decidedAt) : "—"}
        </span>
      ),
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title="Entregas"
        description="Solicitações aprovadas aguardando separação e retirada."
      />

      <p className="text-muted-foreground flex items-start gap-2 text-xs">
        <PackageCheck className="mt-0.5 size-4 shrink-0" aria-hidden />O material já está reservado
        para cada pedido. Ao confirmar a entrega, o saldo é baixado e o comprovante fica disponível
        para o solicitante.
      </p>

      {showBranchFilter ? (
        <div className="flex flex-wrap items-center gap-2">
          <TableFilterSelect
            paramKey="filial"
            placeholder="Unidade"
            allLabel="Todas as unidades"
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          />
          <ClearFilters paramKeys={["filial"]} />
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={result.items}
        getRowId={(row) => row.id}
        basePath="/entregas"
        searchParams={params}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        rowHref={(row) => `/entregas/${row.id}`}
        emptyTitle="Nenhuma entrega pendente"
        emptyDescription="Quando uma solicitação for aprovada, ela aparece aqui para separação."
        emptyAction={
          <Button asChild variant="outline">
            <Link href="/solicitacoes">
              <PackageCheck className="size-4" />
              Ver solicitações
            </Link>
          </Button>
        }
      />
    </PageBody>
  );
}
