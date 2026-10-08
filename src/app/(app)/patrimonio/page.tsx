import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/data-table";
import {
  ClearFilters,
  TableFilterSelect,
  TableSearch,
} from "@/components/data-table/table-filters";
import { AssetStatusBadge } from "@/components/domain/asset-status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAssetTagLabel } from "@/server/services/patrimonio/tag";
import {
  firstParam,
  readPage,
  readPageSize,
  readSearch,
  type RawSearchParams,
} from "@/lib/pagination";
import { requirePagePermission } from "@/server/auth/guards";
import { listAssets } from "@/server/services/patrimonio";

export const metadata: Metadata = {
  title: "Patrimônio",
};

type Row = Awaited<ReturnType<typeof listAssets>>["items"][number];

type PatrimonioPageProps = {
  searchParams: Promise<RawSearchParams>;
};

export default async function PatrimonioPage({ searchParams }: PatrimonioPageProps) {
  const params = await searchParams;
  const context = await requirePagePermission("patrimonio:read");

  const page = readPage(params);
  const pageSize = readPageSize(params);
  const search = readSearch(params);
  const status = firstParam(params, "situacao") ?? null;
  const onlyWithoutCustodian = firstParam(params, "semResponsavel") === "1";
  const branchId = firstParam(params, "filial") ?? null;

  const result = await listAssets(context, {
    search,
    status: status ?? undefined,
    custodian: onlyWithoutCustodian ? "none" : undefined,
    branchId,
    page,
    pageSize,
  });

  const branches = context.isNetworkScope
    ? [...new Map(context.memberships.map((m) => [m.branchId, m])).values()]
    : [];

  const columns: Array<Column<Row>> = [
    {
      key: "asset",
      header: "Bem",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.item.name}</p>
          <p className="text-muted-foreground truncate font-mono text-xs">
            {formatAssetTagLabel(row.tag)} · {row.item.code}
          </p>
        </div>
      ),
      mobile: (row) => row.item.name,
    },
    {
      key: "serial",
      header: "Série",
      cell: (row) => <span className="font-mono text-sm">{row.serialNumber ?? "—"}</span>,
    },
    {
      key: "custodian",
      header: "Responsável",
      cell: (row) =>
        row.custodian ? (
          <span className="text-sm">{row.custodian.name}</span>
        ) : (
          <Badge variant="outline">Almoxarifado</Badge>
        ),
    },
    {
      key: "status",
      header: "Estado",
      cell: (row) => <AssetStatusBadge status={row.status} />,
    },
    {
      key: "branch",
      header: "Unidade",
      cell: (row) => <span className="font-mono text-sm">{row.branch.code}</span>,
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title="Patrimônio"
        description="Bens rastreáveis por número de série: quem é o responsável e o que já aconteceu com cada um."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/estoque/entradas/nova">
              <ShieldCheck className="size-4" />
              Entrada de patrimônio
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <TableSearch placeholder="Buscar por etiqueta, série ou material…" />

        <TableFilterSelect
          paramKey="situacao"
          placeholder="Estado"
          allLabel="Todos os estados"
          options={[
            { value: "IN_STOCK", label: "No almoxarifado" },
            { value: "IN_USE", label: "Em posse de alguém" },
            { value: "IN_MAINTENANCE", label: "Em manutenção" },
            { value: "RETIRED", label: "Baixado" },
          ]}
        />

        {context.isNetworkScope ? (
          <TableFilterSelect
            paramKey="filial"
            placeholder="Unidade"
            allLabel="Todas as unidades"
            options={branches.map((branch) => ({
              value: branch.branchId,
              label: branch.branchCode,
            }))}
          />
        ) : null}

        <ClearFilters paramKeys={["busca", "situacao", "filial", "semResponsavel"]} />

        <Button asChild variant={onlyWithoutCustodian ? "default" : "outline"} size="sm">
          <Link
            href={`/patrimonio${onlyWithoutCustodian ? "" : "?semResponsavel=1"}`}
            aria-pressed={onlyWithoutCustodian}
          >
            Só sem responsável
          </Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={result.items}
        getRowId={(row) => row.id}
        basePath="/patrimonio"
        searchParams={params}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        rowHref={(row) => `/patrimonio/${row.id}`}
        emptyTitle="Nenhum patrimônio encontrado"
        emptyDescription={
          search || status || onlyWithoutCustodian || branchId
            ? "Ajuste os filtros para ver mais resultados."
            : "O patrimônio nasce ao dar entrada em um material com número de série. Registre a entrada para criar os bens."
        }
        emptyAction={
          <Button asChild variant="outline">
            <Link href="/estoque/entradas/nova">Registrar entrada</Link>
          </Button>
        }
      />
    </PageBody>
  );
}
