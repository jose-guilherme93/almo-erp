import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, TriangleAlert } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/data-table";
import { ClearFilters, TableFilterSelect } from "@/components/data-table/table-filters";
import { REQUEST_PRIORITY, REQUEST_STATUS, statusBadge } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration, formatQuantity } from "@/lib/format";
import { firstParam, readPage, readPageSize, type RawSearchParams } from "@/lib/pagination";
import { requirePageAnyPermission } from "@/server/auth/guards";
import { hoursSince, listApprovalQueue, listRequestableBranches } from "@/server/services/request";

export const metadata: Metadata = {
  title: "Fila de aprovação",
};

type Row = Awaited<ReturnType<typeof listApprovalQueue>>["items"][number];

export default async function FilaAprovacaoPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const context = await requirePageAnyPermission(["solicitacao:approve"]);

  // Sem filial escolhida: quem tem escopo de rede vê a fila de todas as
  // unidades; os demais caem na filial ativa (tratado no serviço).
  const requestedBranch = firstParam(params, "filial");
  const branchId =
    requestedBranch && context.branchIds.includes(requestedBranch) ? requestedBranch : null;

  const showBranchFilter = context.isNetworkScope;

  const [result, branches] = await Promise.all([
    listApprovalQueue(context, branchId, {
      page: readPage(params),
      pageSize: readPageSize(params),
    }),
    showBranchFilter ? listRequestableBranches(context) : Promise.resolve([]),
  ]);

  const slaHours = 24;

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
      key: "priority",
      header: "Prioridade",
      cell: (row) => statusBadge(REQUEST_PRIORITY, row.priority),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {statusBadge(REQUEST_STATUS, row.status)}
          {row.claimedBy ? (
            <span className="text-muted-foreground text-xs">com {row.claimedBy.name}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "waiting",
      header: "Esperando há",
      align: "right",
      cell: (row) => {
        const hours = hoursSince(row.createdAt) ?? 0;
        const atRisk = hours > slaHours;

        return (
          <span className="flex items-center justify-end gap-1.5">
            {atRisk ? (
              <TriangleAlert className="size-4 text-amber-600" aria-label="SLA em risco" />
            ) : null}
            <Badge variant="outline" className={atRisk ? "border-amber-300 text-amber-700" : ""}>
              {formatDuration(hours)}
            </Badge>
          </span>
        );
      },
    },
  ];

  const urgentCount = result.items.filter((item) => item.priority === "URGENT").length;
  const atRiskCount = result.items.filter(
    (item) => (hoursSince(item.createdAt) ?? 0) > slaHours,
  ).length;

  return (
    <PageBody>
      <PageHeader
        title={showBranchFilter ? "Fila de aprovação da rede" : "Fila de aprovação"}
        description={
          showBranchFilter
            ? "Solicitações de todas as unidades aguardando decisão. Urgentes primeiro."
            : "Solicitações da sua unidade aguardando decisão. Urgentes primeiro."
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Aguardando decisão</CardDescription>
            <CardTitle className="text-2xl">{result.total}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Urgentes</CardDescription>
            <CardTitle className="text-2xl">{urgentCount}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Acima de {slaHours}h</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              {atRiskCount > 0 ? (
                <TriangleAlert className="size-5 text-amber-600" aria-hidden />
              ) : null}
              {atRiskCount}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

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
        basePath="/solicitacoes/fila"
        searchParams={params}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        rowHref={(row) => `/solicitacoes/${row.id}`}
        emptyTitle="Nenhuma solicitação aguardando decisão"
        emptyDescription={
          showBranchFilter
            ? "Nenhuma unidade tem pedido aguardando aprovação agora."
            : "Quando alguém da sua unidade pedir material, o pedido aparece aqui."
        }
        emptyAction={
          <Button asChild variant="outline">
            <Link href="/solicitacoes">
              <ClipboardCheck className="size-4" />
              Ver todas as solicitações
            </Link>
          </Button>
        }
      />

      {result.items.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          Total de itens aguardando:{" "}
          {formatQuantity(result.items.reduce((total, item) => total + item._count.lines, 0))}. Ao
          aprovar, o saldo é reservado para o pedido.
        </p>
      ) : null}
    </PageBody>
  );
}
