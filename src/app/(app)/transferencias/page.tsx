import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/data-table";
import {
  ClearFilters,
  TableFilterSelect,
  TableSearch,
} from "@/components/data-table/table-filters";
import { statusBadge, TRANSFER_STATUS } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import {
  firstParam,
  readPage,
  readPageSize,
  readSearch,
  type RawSearchParams,
} from "@/lib/pagination";
import { requirePagePermission } from "@/server/auth/guards";
import { listTransfers } from "@/server/services/transfer";

export const metadata: Metadata = {
  title: "Transferências",
};

type Row = Awaited<ReturnType<typeof listTransfers>>["items"][number];

const DIRECTION_TABS = [
  { id: "all", label: "Todas" },
  { id: "incoming", label: "Chegando" },
  { id: "outgoing", label: "Saindo" },
] as const;

export default async function TransferenciasPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const context = await requirePagePermission("transferencia:read");

  const page = readPage(params);
  const pageSize = readPageSize(params);
  const search = readSearch(params);
  const status = firstParam(params, "situacao") ?? null;
  const directionParam = firstParam(params, "sentido") ?? "all";
  const direction = (
    DIRECTION_TABS.some((tab) => tab.id === directionParam) ? directionParam : "all"
  ) as "all" | "incoming" | "outgoing";

  const result = await listTransfers(context, {
    search,
    status,
    direction,
    page,
    pageSize,
  });

  const activeBranch = context.activeBranchId
    ? context.getMembership(context.activeBranchId)
    : undefined;

  const columns: Array<Column<Row>> = [
    {
      key: "number",
      header: "Transferência",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono font-medium">{row.number}</p>
          <p className="text-muted-foreground truncate text-xs">
            {row.originBranch.code} → {row.destinationBranch.code} · {row._count.lines} item(ns)
          </p>
        </div>
      ),
      mobile: (row) => row.number,
    },
    {
      key: "route",
      header: "Trajeto",
      cell: (row) => (
        <span className="text-sm">
          {row.originBranch.name} → {row.destinationBranch.name}
        </span>
      ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (
        <span className="flex items-center gap-1.5">
          {statusBadge(TRANSFER_STATUS, row.status)}
          {context.activeBranchId === row.destinationBranch.id &&
          (row.status === "SENT" || row.status === "IN_TRANSIT") ? (
            <Badge variant="outline" className="border-sky-300 text-sky-700">
              chegando
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Criada em",
      align: "right",
      cell: (row) => (
        <span className="text-muted-foreground text-sm">{formatDateTime(row.createdAt)}</span>
      ),
    },
    {
      key: "author",
      header: "Responsável",
      cell: (row) => <span className="text-sm">{row.createdBy.name}</span>,
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title="Transferências"
        description={
          activeBranch
            ? `Movimentação de material entre unidades, com ${activeBranch.branchName} como referência.`
            : "Movimentação de material entre unidades."
        }
        action={
          context.hasPermission("transferencia:create") ? (
            <Button asChild>
              <Link href="/transferencias/nova">
                <Plus className="size-4" />
                Nova transferência
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        {DIRECTION_TABS.map((tab) => (
          <Link
            key={tab.id}
            href={`/transferencias?sentido=${tab.id}`}
            aria-current={direction === tab.id ? "page" : undefined}
            className={
              direction === tab.id
                ? "bg-accent text-accent-foreground rounded-md px-3 py-1.5 text-sm font-medium"
                : "text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-sm"
            }
          >
            {tab.label}
          </Link>
        ))}

        <span className="text-muted-foreground ml-auto flex items-center gap-1 text-xs">
          <ArrowLeftRight className="size-3.5" aria-hidden />
          Origem → destino
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TableSearch placeholder="Buscar por número…" />

        <TableFilterSelect
          paramKey="situacao"
          placeholder="Situação"
          allLabel="Todas as situações"
          options={Object.entries(TRANSFER_STATUS).map(([value, descriptor]) => ({
            value,
            label: descriptor.label,
          }))}
        />

        <ClearFilters paramKeys={["busca", "situacao", "sentido"]} />
      </div>

      <DataTable
        columns={columns}
        rows={result.items}
        getRowId={(row) => row.id}
        basePath="/transferencias"
        searchParams={params}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        rowHref={(row) => `/transferencias/${row.id}`}
        emptyTitle="Nenhuma transferência encontrada"
        emptyDescription={
          search || status
            ? "Ajuste os filtros para ver mais resultados."
            : "Crie uma transferência para mover material entre unidades."
        }
        emptyAction={
          context.hasPermission("transferencia:create") ? (
            <Button asChild variant="outline">
              <Link href="/transferencias/nova">Criar transferência</Link>
            </Button>
          ) : null
        }
      />
    </PageBody>
  );
}
