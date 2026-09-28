import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/data-table";
import {
  ClearFilters,
  TableFilterSelect,
  TableSearch,
} from "@/components/data-table/table-filters";
import {
  MAINTENANCE_STATUS_BADGE,
  MAINTENANCE_PRIORITY_BADGE,
  statusBadge,
} from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/format";
import {
  firstParam,
  readPage,
  readPageSize,
  readSearch,
  type RawSearchParams,
} from "@/lib/pagination";
import { requirePagePermission } from "@/server/auth/guards";
import {
  MAINTENANCE_CATEGORY_LABELS,
  listMaintenanceRequests,
} from "@/server/services/maintenance";

export const metadata: Metadata = {
  title: "Reparos",
};

type Row = Awaited<ReturnType<typeof listMaintenanceRequests>>["items"][number];

export default async function ReparosPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const context = await requirePagePermission("manutencao:read");

  const canOverview = context.hasPermission("manutencao:overview");
  const mineOnly = firstParam(params, "meus") === "1";

  const result = await listMaintenanceRequests(context, {
    search: readSearch(params),
    status: firstParam(params, "situacao") ?? null,
    category: firstParam(params, "tipo") ?? null,
    priority: firstParam(params, "prioridade") ?? null,
    mineOnly,
    page: readPage(params),
    pageSize: readPageSize(params),
  });

  const columns: Array<Column<Row>> = [
    {
      key: "title",
      header: "Chamado",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.title}</p>
          <p className="text-muted-foreground truncate font-mono text-xs">
            {row.number} · {row.location}
          </p>
        </div>
      ),
      mobile: (row) => row.title,
    },
    {
      key: "category",
      header: "Tipo",
      cell: (row) => (
        <span className="text-sm">{MAINTENANCE_CATEGORY_LABELS[row.category] ?? row.category}</span>
      ),
    },
    {
      key: "priority",
      header: "Prioridade",
      cell: (row) =>
        row.priority ? (
          statusBadge(MAINTENANCE_PRIORITY_BADGE, row.priority)
        ) : (
          <Badge variant="outline" className="border-amber-300 text-amber-700">
            a classificar
          </Badge>
        ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => statusBadge(MAINTENANCE_STATUS_BADGE, row.status),
    },
    {
      key: "assignedTo",
      header: "Atendendo",
      cell: (row) =>
        row.assignedTo ? (
          <span className="text-sm">{row.assignedTo.name}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      key: "createdAt",
      header: "Aberto",
      align: "right",
      cell: (row) => (
        <span className="text-muted-foreground text-sm">{formatRelative(row.createdAt)}</span>
      ),
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title={canOverview ? "Chamados" : "Meus chamados"}
        description={
          canOverview
            ? "Manutenção, TI e demais setores de atendimento."
            : "Reparos e chamados que você abriu."
        }
        action={
          context.hasPermission("manutencao:create") ? (
            <Button asChild>
              <Link href="/reparos/novo">
                <Plus className="size-4" />
                Abrir chamado
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <TableSearch placeholder="Buscar por número, título ou local…" />

        <TableFilterSelect
          paramKey="tipo"
          placeholder="Tipo"
          allLabel="Todos os tipos"
          options={Object.entries(MAINTENANCE_CATEGORY_LABELS).map(([value, label]) => ({
            value,
            label,
          }))}
        />

        <TableFilterSelect
          paramKey="situacao"
          placeholder="Situação"
          allLabel="Todas as situações"
          options={Object.entries(MAINTENANCE_STATUS_BADGE).map(([value, descriptor]) => ({
            value,
            label: descriptor.label,
          }))}
        />

        <TableFilterSelect
          paramKey="prioridade"
          placeholder="Prioridade"
          allLabel="Todas as prioridades"
          options={Object.entries(MAINTENANCE_PRIORITY_BADGE).map(([value, descriptor]) => ({
            value,
            label: descriptor.label,
          }))}
        />

        <ClearFilters paramKeys={["busca", "tipo", "situacao", "prioridade", "meus"]} />

        {canOverview ? (
          <Link
            href={mineOnly ? "/reparos" : "/reparos?meus=1"}
            aria-pressed={mineOnly}
            className={
              mineOnly
                ? "bg-primary text-primary-foreground inline-flex h-8 items-center rounded-md px-3 text-sm"
                : "border-input hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-sm"
            }
          >
            Só os meus
          </Link>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={result.items}
        getRowId={(row) => row.id}
        basePath="/reparos"
        searchParams={params}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        rowHref={(row) => `/reparos/${row.id}`}
        emptyTitle="Nenhum chamado encontrado"
        emptyDescription={
          readSearch(params)
            ? "Ajuste os filtros para ver mais resultados."
            : "Nenhum reparo registrado nesta unidade ainda."
        }
        emptyAction={
          context.hasPermission("manutencao:create") ? (
            <Button asChild variant="outline">
              <Link href="/reparos/novo">Abrir chamado</Link>
            </Button>
          ) : null
        }
      />
    </PageBody>
  );
}
