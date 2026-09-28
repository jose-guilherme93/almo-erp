import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/data-table";
import {
  ClearFilters,
  TableFilterSelect,
  TableSearch,
} from "@/components/data-table/table-filters";
import { statusBadge, USER_STATUS } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import {
  firstParam,
  readPage,
  readPageSize,
  readSearch,
  type RawSearchParams,
} from "@/lib/pagination";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/server/auth/guards";
import { listUsers } from "@/server/services/user";

export const metadata: Metadata = {
  title: "Usuários",
};

type Row = Awaited<ReturnType<typeof listUsers>>["items"][number];

type UsuariosPageProps = {
  searchParams: Promise<RawSearchParams>;
};

export default async function UsuariosPage({ searchParams }: UsuariosPageProps) {
  const params = await searchParams;
  const context = await requirePagePermission("usuario:read");

  const page = readPage(params);
  const pageSize = readPageSize(params);
  const search = readSearch(params);
  const branchId = firstParam(params, "filial") ?? null;
  const roleId = firstParam(params, "perfil") ?? null;
  const status = firstParam(params, "situacao") ?? null;

  const [result, roles, branches] = await Promise.all([
    listUsers(context, { search, branchId, roleId, status, page, pageSize }),
    prisma.role.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, scope: true },
    }),
    prisma.branch.findMany({
      where: { active: true, id: { in: context.branchIds } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);

  const columns: Array<Column<Row>> = [
    {
      key: "name",
      header: "Nome",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="text-muted-foreground truncate text-xs">{row.email}</p>
        </div>
      ),
      mobile: (row) => row.name,
    },
    {
      key: "branches",
      header: "Unidades",
      cell: (row) =>
        row.memberships.length === 0 ? (
          <span className="text-muted-foreground text-xs">Sem vínculo</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.memberships.slice(0, 3).map((membership) => (
              <span
                key={`${membership.branch.id}-${membership.role.id}`}
                className="bg-muted rounded px-1.5 py-0.5 text-xs"
                title={`${membership.branch.name} · ${membership.role.name}`}
              >
                {membership.branch.code}
              </span>
            ))}
            {row.memberships.length > 3 ? (
              <span className="text-muted-foreground text-xs">+{row.memberships.length - 3}</span>
            ) : null}
          </div>
        ),
    },
    {
      key: "roles",
      header: "Perfis",
      cell: (row) => (
        <span className="text-sm">
          {[...new Set(row.memberships.map((membership) => membership.role.name))].join(", ") ||
            "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => statusBadge(USER_STATUS, row.status),
    },
    {
      key: "lastLoginAt",
      header: "Último acesso",
      align: "right",
      cell: (row) =>
        row.lastLoginAt ? (
          <span className="text-muted-foreground text-sm">{formatDateTime(row.lastLoginAt)}</span>
        ) : (
          <span className="text-muted-foreground text-sm">Nunca acessou</span>
        ),
    },
  ];

  const canManage = context.hasPermission("usuario:manage");

  return (
    <PageBody>
      <PageHeader
        title="Usuários"
        description={
          context.isNetworkScope
            ? "Quem tem acesso ao sistema, com quais perfis e em quais unidades."
            : "Usuários vinculados às unidades que você administra."
        }
        action={
          canManage ? (
            <Button asChild>
              <Link href="/admin/usuarios/novo">
                <Plus className="size-4" />
                Novo usuário
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <TableSearch placeholder="Buscar por nome ou e-mail…" />

        <TableFilterSelect
          paramKey="filial"
          placeholder="Unidade"
          allLabel="Todas as unidades"
          options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
        />

        <TableFilterSelect
          paramKey="perfil"
          placeholder="Perfil"
          allLabel="Todos os perfis"
          options={roles.map((role) => ({ value: role.id, label: role.name }))}
        />

        <TableFilterSelect
          paramKey="situacao"
          placeholder="Situação"
          allLabel="Todas as situações"
          options={Object.entries(USER_STATUS).map(([value, descriptor]) => ({
            value,
            label: descriptor.label,
          }))}
        />

        <ClearFilters paramKeys={["busca", "filial", "perfil", "situacao"]} />
      </div>

      <DataTable
        columns={columns}
        rows={result.items}
        getRowId={(row) => row.id}
        basePath="/admin/usuarios"
        searchParams={params}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        rowHref={(row) => `/admin/usuarios/${row.id}`}
        emptyTitle="Nenhum usuário encontrado"
        emptyDescription={
          search || branchId || roleId || status
            ? "Ajuste os filtros para ver mais resultados."
            : "Cadastre o primeiro usuário para liberar o acesso ao sistema."
        }
        emptyAction={
          canManage && !search ? (
            <Button asChild variant="outline">
              <Link href="/admin/usuarios/novo">Cadastrar usuário</Link>
            </Button>
          ) : null
        }
      />
    </PageBody>
  );
}
