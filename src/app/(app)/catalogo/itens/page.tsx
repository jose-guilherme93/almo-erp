import type { Metadata } from "next";
import Link from "next/link";
import { Plus, TriangleAlert } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/data-table";
import {
  ClearFilters,
  TableFilterSelect,
  TableSearch,
} from "@/components/data-table/table-filters";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatQuantity } from "@/lib/format";
import {
  firstParam,
  readPage,
  readPageSize,
  readSearch,
  type RawSearchParams,
} from "@/lib/pagination";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/server/auth/guards";
import { listItems } from "@/server/services/catalog/item";

export const metadata: Metadata = {
  title: "Materiais",
};

type Row = Awaited<ReturnType<typeof listItems>>["items"][number];

type ItensPageProps = {
  searchParams: Promise<RawSearchParams>;
};

export default async function ItensPage({ searchParams }: ItensPageProps) {
  const params = await searchParams;
  const context = await requirePagePermission("item:read");

  const page = readPage(params);
  const pageSize = readPageSize(params);
  const search = readSearch(params);
  const categoryId = firstParam(params, "categoria") ?? null;
  const unitId = firstParam(params, "unidade") ?? null;
  const status = firstParam(params, "situacao") ?? null;
  const onlyBelowMinimum = firstParam(params, "abaixoMinimo") === "1";
  const onlyWithoutPolicy = firstParam(params, "semPolitica") === "1";

  const [result, categories, units] = await Promise.all([
    listItems(context, {
      search,
      categoryId,
      unitId,
      status,
      onlyBelowMinimum,
      onlyWithoutPolicy,
      page,
      pageSize,
    }),
    prisma.category.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.unit.findMany({
      where: { active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true },
    }),
  ]);

  const activeBranch = context.activeBranchId
    ? context.getMembership(context.activeBranchId)
    : undefined;

  const canCreate = context.hasPermission("item:create");

  const columns: Array<Column<Row>> = [
    {
      key: "name",
      header: "Material",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {row.name}
            {!row.active ? (
              <Badge variant="outline" className="ml-2">
                inativo
              </Badge>
            ) : null}
          </p>
          <p className="text-muted-foreground truncate font-mono text-xs">
            {row.code}
            {row.barcode ? ` · ${row.barcode}` : ""}
          </p>
        </div>
      ),
      mobile: (row) => row.name,
    },
    {
      key: "category",
      header: "Categoria",
      cell: (row) => <span className="text-sm">{row.category.name}</span>,
    },
    {
      key: "unit",
      header: "Unidade",
      cell: (row) => <span className="font-mono text-sm">{row.unit.code}</span>,
    },
    {
      key: "balance",
      header: `Saldo${activeBranch ? ` · ${activeBranch.branchCode}` : ""}`,
      align: "right",
      cell: (row) =>
        row.availableQuantity === null ? (
          <span className="text-muted-foreground text-sm">—</span>
        ) : (
          <span className="flex items-center justify-end gap-1.5 text-sm">
            {row.belowMinimum ? (
              <TriangleAlert className="size-4 text-amber-600" aria-label="Abaixo do mínimo" />
            ) : null}
            {formatQuantity(row.availableQuantity)}
            {row.minimumQuantity !== null ? (
              <span className="text-muted-foreground text-xs">
                / mín {formatQuantity(row.minimumQuantity)}
              </span>
            ) : null}
          </span>
        ),
    },
    {
      key: "price",
      header: "Preço de referência",
      align: "right",
      cell: (row) => <span className="text-sm">{formatCurrency(row.referencePrice)}</span>,
    },
    {
      key: "flags",
      header: "Controles",
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.controlledByLot ? <Badge variant="outline">lote</Badge> : null}
          {row.perishable ? <Badge variant="outline">perecível</Badge> : null}
          {row.requiresApproval ? <Badge variant="outline">aprovação</Badge> : null}
        </div>
      ),
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title="Materiais"
        description="Catálogo de tudo que entra e sai do almoxarifado."
        action={
          canCreate ? (
            <Button asChild>
              <Link href="/catalogo/itens/novo">
                <Plus className="size-4" />
                Novo material
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <TableSearch placeholder="Buscar por nome, código ou código de barras…" />

        <TableFilterSelect
          paramKey="categoria"
          placeholder="Categoria"
          allLabel="Todas as categorias"
          options={categories.map((category) => ({ value: category.id, label: category.name }))}
        />

        <TableFilterSelect
          paramKey="unidade"
          placeholder="Unidade"
          allLabel="Todas as unidades"
          options={units.map((unit) => ({ value: unit.id, label: unit.code }))}
        />

        <TableFilterSelect
          paramKey="situacao"
          placeholder="Situação"
          allLabel="Todas as situações"
          options={[
            { value: "active", label: "Ativos" },
            { value: "inactive", label: "Inativos" },
          ]}
        />

        <ClearFilters
          paramKeys={["busca", "categoria", "unidade", "situacao", "abaixoMinimo", "semPolitica"]}
        />

        <div className="flex flex-wrap gap-1">
          <Button asChild variant={onlyBelowMinimum ? "default" : "outline"} size="sm">
            <Link
              href={`/catalogo/itens${onlyBelowMinimum ? "" : "?abaixoMinimo=1"}`}
              aria-pressed={onlyBelowMinimum}
            >
              Só abaixo do mínimo
            </Link>
          </Button>

          <Button asChild variant={onlyWithoutPolicy ? "default" : "outline"} size="sm">
            <Link
              href={`/catalogo/itens${onlyWithoutPolicy ? "" : "?semPolitica=1"}`}
              aria-pressed={onlyWithoutPolicy}
            >
              Só sem mínimo definido
            </Link>
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={result.items}
        getRowId={(row) => row.id}
        basePath="/catalogo/itens"
        searchParams={params}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        rowHref={(row) => `/catalogo/itens/${row.id}`}
        emptyTitle="Nenhum material encontrado"
        emptyDescription={
          search || categoryId || unitId || status || onlyBelowMinimum || onlyWithoutPolicy
            ? "Ajuste os filtros para ver mais resultados."
            : "O material pode ser cadastrado aqui, ou direto na entrada de estoque lendo o código de barras com a câmera."
        }
        emptyAction={
          canCreate ? (
            <Button asChild variant="outline">
              <Link href="/catalogo/itens/novo">Cadastrar material</Link>
            </Button>
          ) : null
        }
      />
    </PageBody>
  );
}
