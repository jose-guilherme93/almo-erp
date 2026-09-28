import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/data-table";
import {
  ClearFilters,
  TableFilterSelect,
  TableSearch,
} from "@/components/data-table/table-filters";
import { REQUEST_PRIORITY, REQUEST_STATUS, statusBadge } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  firstParam,
  readPage,
  readPageSize,
  readSearch,
  type RawSearchParams,
} from "@/lib/pagination";
import { requirePagePermission } from "@/server/auth/guards";
import { listRequests } from "@/server/services/request";

export const metadata: Metadata = {
  title: "Solicitações",
};

type Row = Awaited<ReturnType<typeof listRequests>>["items"][number];

export default async function SolicitacoesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const context = await requirePagePermission("solicitacao:read");

  // Por padrão mostramos as próprias solicitações; quem aprova pode ver todas.
  const mineOnly = firstParam(params, "minhas") !== "0";

  const result = await listRequests(context, {
    search: readSearch(params),
    status: firstParam(params, "situacao") ?? null,
    priority: firstParam(params, "prioridade") ?? null,
    requesterId: mineOnly ? context.user.id : null,
    page: readPage(params),
    pageSize: readPageSize(params),
  });

  const columns: Array<Column<Row>> = [
    {
      key: "number",
      header: "Solicitação",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono font-medium">{row.number}</p>
          <p className="text-muted-foreground truncate text-xs">
            {row.branch.code} ·{" "}
            {mineOnly ? `${row._count.lines} item(ns)` : `${row.requester.name}`}
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
      key: "createdAt",
      header: "Criada em",
      cell: (row) => (
        <span className="text-muted-foreground text-sm">{formatDateTime(row.createdAt)}</span>
      ),
    },
    {
      key: "neededAt",
      header: "Precisa para",
      cell: (row) =>
        row.neededAt ? (
          <span className="text-sm">{formatDate(row.neededAt)}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title={mineOnly ? "Minhas solicitações" : "Solicitações da unidade"}
        description={
          mineOnly
            ? "Acompanhe o andamento dos seus pedidos de material."
            : "Todas as solicitações da sua unidade."
        }
        action={
          context.hasPermission("solicitacao:create") ? (
            <Button asChild>
              <Link href="/solicitacoes/nova">
                <Plus className="size-4" />
                Nova solicitação
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <TableSearch placeholder="Buscar por número…" />

        <TableFilterSelect
          paramKey="situacao"
          placeholder="Situação"
          allLabel="Todas as situações"
          options={Object.entries(REQUEST_STATUS).map(([value, descriptor]) => ({
            value,
            label: descriptor.label,
          }))}
        />

        <TableFilterSelect
          paramKey="prioridade"
          placeholder="Prioridade"
          allLabel="Todas as prioridades"
          options={Object.entries(REQUEST_PRIORITY).map(([value, descriptor]) => ({
            value,
            label: descriptor.label,
          }))}
        />

        <ClearFilters paramKeys={["busca", "situacao", "prioridade", "minhas"]} />

        {context.hasPermission("solicitacao:approve") ? (
          <Link
            href={mineOnly ? "/solicitacoes?minhas=0" : "/solicitacoes"}
            className="border-input hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-sm"
          >
            {mineOnly ? "Ver todas da unidade" : "Ver só as minhas"}
          </Link>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={result.items}
        getRowId={(row) => row.id}
        basePath="/solicitacoes"
        searchParams={params}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        rowHref={(row) => `/solicitacoes/${row.id}`}
        emptyTitle="Nenhuma solicitação encontrada"
        emptyDescription={
          mineOnly
            ? "Você ainda não fez nenhum pedido de material."
            : "Ajuste os filtros para ver mais resultados."
        }
        emptyAction={
          context.hasPermission("solicitacao:create") ? (
            <Button asChild variant="outline">
              <Link href="/solicitacoes/nova">Solicitar material</Link>
            </Button>
          ) : null
        }
      />
    </PageBody>
  );
}
