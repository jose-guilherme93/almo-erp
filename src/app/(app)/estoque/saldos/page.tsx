import type { Metadata } from "next";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

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
import { readRequestedBranchId } from "@/server/auth/scope";
import { listRequestableBranches } from "@/server/services/request";
import { listStockLevels } from "@/server/services/stock/levels";

export const metadata: Metadata = {
  title: "Saldos",
};

type Row = Awaited<ReturnType<typeof listStockLevels>>["items"][number];

type SaldosPageProps = {
  searchParams: Promise<RawSearchParams>;
};

export default async function SaldosPage({ searchParams }: SaldosPageProps) {
  const params = await searchParams;
  const context = await requirePagePermission("estoque:read");

  const page = readPage(params);
  const pageSize = readPageSize(params);
  const search = readSearch(params);
  const categoryId = firstParam(params, "categoria") ?? null;
  const locationId = firstParam(params, "local") ?? null;
  const onlyBelowMinimum = firstParam(params, "abaixoMinimo") === "1";
  const onlyStale = firstParam(params, "semMovimento") === "1";

  const showBranchFilter = context.isNetworkScope;
  const branchId = readRequestedBranchId(context, firstParam(params, "filial"));
  const locationsBranchId = branchId ?? context.activeBranchId;

  const [result, categories, locations, branches] = await Promise.all([
    listStockLevels(context, {
      search,
      branchId,
      categoryId,
      storageLocationId: locationId,
      onlyBelowMinimum,
      onlyWithoutMovementDays: onlyStale ? 90 : null,
      page,
      pageSize,
    }),
    prisma.category.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    locationsBranchId
      ? prisma.storageLocation.findMany({
          where: { branchId: locationsBranchId, active: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    showBranchFilter ? listRequestableBranches(context) : Promise.resolve([]),
  ]);

  const activeBranch = context.activeBranchId
    ? context.getMembership(context.activeBranchId)
    : undefined;

  const selectedBranchName = branchId
    ? branches.find((branch) => branch.id === branchId)?.name
    : undefined;

  const columns: Array<Column<Row>> = [
    {
      key: "item",
      header: "Material",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.itemName}</p>
          <p className="text-muted-foreground truncate font-mono text-xs">
            {row.itemCode} · {row.categoryName}
          </p>
        </div>
      ),
      mobile: (row) => row.itemName,
    },
    {
      key: "location",
      header: "Local",
      cell: (row) => <span className="text-sm">{row.storageLocationName}</span>,
    },
    {
      key: "quantity",
      header: "Saldo",
      align: "right",
      cell: (row) => (
        <span className="text-sm">
          {formatQuantity(row.quantity)} {row.unitCode}
        </span>
      ),
    },
    {
      key: "reserved",
      header: "Reservado",
      align: "right",
      cell: (row) => (
        <span className="text-muted-foreground text-sm">
          {formatQuantity(row.reservedQuantity)}
        </span>
      ),
    },
    {
      key: "available",
      header: "Disponível",
      align: "right",
      cell: (row) => (
        <span className="flex items-center justify-end gap-1.5 text-sm font-medium">
          {row.belowMinimum ? (
            <TriangleAlert className="size-4 text-amber-600" aria-label="Abaixo do mínimo" />
          ) : null}
          {formatQuantity(row.availableQuantity)}
        </span>
      ),
    },
    {
      key: "minimum",
      header: "Mínimo",
      align: "right",
      cell: (row) =>
        row.minimumQuantity === null ? (
          <span className="text-muted-foreground text-xs">não definido</span>
        ) : (
          <span className="text-sm">{formatQuantity(row.minimumQuantity)}</span>
        ),
    },
    {
      key: "value",
      header: "Valor",
      align: "right",
      cell: (row) => <span className="text-sm">{formatCurrency(row.totalValue)}</span>,
    },
    {
      key: "lastMovement",
      header: "Último movimento",
      align: "right",
      cell: (row) =>
        row.lastMovementAt ? (
          <span className="text-muted-foreground text-xs">
            {new Date(row.lastMovementAt).toLocaleDateString("pt-BR")}
          </span>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            nunca
          </Badge>
        ),
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title="Saldos"
        description={
          selectedBranchName
            ? `Posição atual de ${selectedBranchName}.`
            : activeBranch
              ? `Posição atual de ${activeBranch.branchName}.`
              : "Posição atual do estoque."
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <TableSearch placeholder="Buscar material…" />

        <TableFilterSelect
          paramKey="categoria"
          placeholder="Categoria"
          allLabel="Todas as categorias"
          options={categories.map((category) => ({ value: category.id, label: category.name }))}
        />

        {showBranchFilter ? (
          <TableFilterSelect
            paramKey="filial"
            placeholder="Unidade"
            allLabel="Escolha uma unidade"
            options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
          />
        ) : null}

        {locations.length > 0 ? (
          <TableFilterSelect
            paramKey="local"
            placeholder="Local"
            allLabel="Todos os locais"
            options={locations.map((location) => ({ value: location.id, label: location.name }))}
          />
        ) : null}

        <ClearFilters
          paramKeys={["busca", "categoria", "local", "abaixoMinimo", "semMovimento", "filial"]}
        />

        <div className="flex flex-wrap gap-1">
          <FilterToggle
            paramKey="abaixoMinimo"
            active={onlyBelowMinimum}
            label="Só abaixo do mínimo"
          />
          <FilterToggle
            paramKey="semMovimento"
            active={onlyStale}
            label="Sem movimento (90 dias)"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={result.items}
        getRowId={(row) => row.id}
        basePath="/estoque/saldos"
        searchParams={params}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        emptyTitle="Nenhum saldo encontrado"
        emptyDescription={
          search || categoryId || locationId || onlyBelowMinimum || onlyStale
            ? "Ajuste os filtros para ver mais resultados."
            : "Lance uma entrada para começar a formar estoque. Na doca, a câmera lê o código de barras e o material entra junto."
        }
        emptyAction={
          context.hasPermission("estoque:entrada") ? (
            <Button asChild variant="outline">
              <Link href="/estoque/entradas/nova">Registrar entrada</Link>
            </Button>
          ) : null
        }
      />
    </PageBody>
  );
}

/** Alterna um filtro booleano na URL (o valor é sempre `1` ou ausente). */
function FilterToggle({
  paramKey,
  active,
  label,
}: {
  paramKey: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={active ? "/estoque/saldos" : `/estoque/saldos?${paramKey}=1`}
      aria-pressed={active}
      className={
        active
          ? "bg-primary text-primary-foreground inline-flex h-8 items-center rounded-md px-3 text-sm font-medium"
          : "border-input hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-sm"
      }
    >
      {label}
    </Link>
  );
}
