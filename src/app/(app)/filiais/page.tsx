import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import {
  ClearFilters,
  TableFilterSelect,
  TableSearch,
} from "@/components/data-table/table-filters";
import { DataTable, type Column } from "@/components/data-table/data-table";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCnpj } from "@/lib/format";
import {
  firstParam,
  readPage,
  readPageSize,
  readSearch,
  type RawSearchParams,
} from "@/lib/pagination";
import { UF_CODES } from "@/lib/validation/br";
import { requirePagePermission } from "@/server/auth/guards";
import { listBranches } from "@/server/services/branch";

export const metadata: Metadata = {
  title: "Unidades",
};

type Row = Awaited<ReturnType<typeof listBranches>>["items"][number];

type FiliaisPageProps = {
  searchParams: Promise<RawSearchParams>;
};

export default async function FiliaisPage({ searchParams }: FiliaisPageProps) {
  const params = await searchParams;
  const context = await requirePagePermission("filial:read");

  const page = readPage(params);
  const pageSize = readPageSize(params);
  const search = readSearch(params);
  const type = firstParam(params, "tipo") ?? null;
  const state = firstParam(params, "uf") ?? null;
  const status = firstParam(params, "situacao") ?? null;

  const result = await listBranches(context, { search, type, state, status, page, pageSize });

  const canCreate = context.hasPermission("filial:create");

  const columns: Array<Column<Row>> = [
    {
      key: "name",
      header: "Unidade",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {row.name}
            {row.type === "MATRIX" ? (
              <Badge variant="default" className="ml-2">
                matriz
              </Badge>
            ) : null}
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {row.code}
            {row.cnpj ? ` · ${formatCnpj(row.cnpj)}` : ""}
          </p>
        </div>
      ),
      mobile: (row) => row.name,
    },
    {
      key: "location",
      header: "Localização",
      cell: (row) => (
        <span className="text-sm">
          {row.city ? `${row.city}${row.state ? `/${row.state}` : ""}` : "—"}
        </span>
      ),
    },
    {
      key: "warehouse",
      header: "Responsável pelo almoxarifado",
      cell: (row) =>
        row.warehouseResponsible ? (
          <span className="text-sm">{row.warehouseResponsible.name}</span>
        ) : (
          <span className="text-muted-foreground text-xs">não definido</span>
        ),
    },
    {
      key: "approver",
      header: "Aprovador padrão",
      cell: (row) =>
        row.defaultApprover ? (
          <span className="text-sm">{row.defaultApprover.name}</span>
        ) : (
          <span className="text-muted-foreground text-xs">não definido</span>
        ),
    },
    {
      key: "counts",
      header: "Locais / usuários",
      align: "right",
      cell: (row) => (
        <span className="text-sm">
          {row._count.storageLocations} / {row._count.memberships}
        </span>
      ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (
        <Badge variant={row.active ? "secondary" : "outline"}>
          {row.active ? "Ativa" : "Inativa"}
        </Badge>
      ),
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title="Unidades"
        description="Matriz e filiais, com endereço, responsáveis e locais de estoque."
        action={
          canCreate ? (
            <Button asChild>
              <Link href="/filiais/nova">
                <Plus className="size-4" />
                Nova unidade
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <TableSearch placeholder="Buscar por nome, código ou cidade…" />

        <TableFilterSelect
          paramKey="tipo"
          placeholder="Tipo"
          allLabel="Todos os tipos"
          options={[
            { value: "MATRIX", label: "Matriz" },
            { value: "BRANCH", label: "Unidades" },
          ]}
        />

        <TableFilterSelect
          paramKey="uf"
          placeholder="UF"
          allLabel="Todas as UFs"
          options={UF_CODES.map((code) => ({ value: code, label: code }))}
        />

        <TableFilterSelect
          paramKey="situacao"
          placeholder="Situação"
          allLabel="Todas as situações"
          options={[
            { value: "active", label: "Ativas" },
            { value: "inactive", label: "Inativas" },
          ]}
        />

        <ClearFilters paramKeys={["busca", "tipo", "uf", "situacao"]} />
      </div>

      <DataTable
        columns={columns}
        rows={result.items}
        getRowId={(row) => row.id}
        basePath="/filiais"
        searchParams={params}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        rowHref={(row) => `/filiais/${row.id}`}
        emptyTitle="Nenhuma unidade encontrada"
        emptyDescription={
          search || type || state || status
            ? "Ajuste os filtros para ver mais resultados."
            : "Cadastre a matriz e as unidades operacionais."
        }
        emptyAction={
          canCreate ? (
            <Button asChild variant="outline">
              <Link href="/filiais/nova">Cadastrar unidade</Link>
            </Button>
          ) : null
        }
      />
    </PageBody>
  );
}
