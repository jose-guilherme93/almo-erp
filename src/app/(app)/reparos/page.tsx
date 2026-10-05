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
  buildQueryString,
  firstParam,
  readPage,
  readPageSize,
  readSearch,
  type RawSearchParams,
} from "@/lib/pagination";
import { requirePagePermission } from "@/server/auth/guards";
import { readRequestedBranchId } from "@/server/auth/scope";
import {
  CLOSED_MAINTENANCE_STATUSES,
  MAINTENANCE_CATEGORY_LABELS,
  OPEN_MAINTENANCE_STATUSES,
  listMaintenanceRequests,
  listRequestableBranchesForMaintenance,
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
  const canAttend = context.hasPermission("manutencao:atender");
  const mineOnly = firstParam(params, "meus") === "1";

  const showBranchFilter = context.isNetworkScope;
  const branchId = readRequestedBranchId(context, firstParam(params, "filial"));

  // Visão padrão: chamados em aberto. "Concluídos" mostra os encerrados.
  const situacao = firstParam(params, "situacao") ?? null;
  const vista = firstParam(params, "vista") === "concluidos" ? "concluidos" : "abertos";
  const statuses = situacao
    ? null
    : vista === "concluidos"
      ? CLOSED_MAINTENANCE_STATUSES
      : OPEN_MAINTENANCE_STATUSES;

  const [result, branches] = await Promise.all([
    listMaintenanceRequests(context, {
      search: readSearch(params),
      status: situacao,
      statuses,
      category: firstParam(params, "tipo") ?? null,
      priority: firstParam(params, "prioridade") ?? null,
      branchId,
      mineOnly,
      page: readPage(params),
      pageSize: readPageSize(params),
    }),
    showBranchFilter ? listRequestableBranchesForMaintenance(context) : Promise.resolve([]),
  ]);

  const columns: Array<Column<Row>> = [
    {
      key: "title",
      header: "Chamado",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.title}</p>
          <p className="text-muted-foreground truncate font-mono text-xs">
            {row.number} · {row.location}
            {showBranchFilter ? ` · ${row.branch.code}` : ""}
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
        title={canOverview ? "Chamados" : canAttend ? "Chamados do setor" : "Meus chamados"}
        description={
          canOverview
            ? "Manutenção, TI e demais setores de atendimento."
            : canAttend
              ? "Chamados roteados ao seu setor, encaminhados a ele ou atribuídos a você."
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
        <div
          className="border-input inline-flex h-8 items-center rounded-md border p-0.5"
          role="group"
          aria-label="Situação dos chamados"
        >
          <Link
            href={`/reparos${buildQueryString(params, { vista: null, situacao: null, pagina: null })}`}
            aria-current={vista === "abertos" && !situacao ? "page" : undefined}
            className={
              vista === "abertos" && !situacao
                ? "bg-primary text-primary-foreground inline-flex h-7 items-center rounded px-3 text-sm"
                : "text-muted-foreground hover:text-foreground inline-flex h-7 items-center rounded px-3 text-sm"
            }
          >
            Em aberto
          </Link>
          <Link
            href={`/reparos${buildQueryString(params, { vista: "concluidos", situacao: null, pagina: null })}`}
            aria-current={vista === "concluidos" && !situacao ? "page" : undefined}
            className={
              vista === "concluidos" && !situacao
                ? "bg-primary text-primary-foreground inline-flex h-7 items-center rounded px-3 text-sm"
                : "text-muted-foreground hover:text-foreground inline-flex h-7 items-center rounded px-3 text-sm"
            }
          >
            Concluídos
          </Link>
        </div>

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

        {showBranchFilter ? (
          <TableFilterSelect
            paramKey="filial"
            placeholder="Unidade"
            allLabel="Todas as unidades"
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          />
        ) : null}

        <ClearFilters paramKeys={["busca", "tipo", "situacao", "prioridade", "meus", "filial"]} />

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
