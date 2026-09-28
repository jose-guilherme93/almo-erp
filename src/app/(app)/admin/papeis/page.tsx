import type { Metadata } from "next";
import Link from "next/link";
import { Plus, ShieldCheck } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/data-table";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirePagePermission } from "@/server/auth/guards";
import { listRoles } from "@/server/services/role";

export const metadata: Metadata = {
  title: "Perfis e permissões",
};

type Row = Awaited<ReturnType<typeof listRoles>>[number];

export default async function PapeisPage() {
  const context = await requirePagePermission("papel:read");
  const roles = await listRoles();

  const canManage = context.hasPermission("papel:manage");

  const columns: Array<Column<Row>> = [
    {
      key: "name",
      header: "Perfil",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {row.name}
            {row.isSystem ? (
              <span className="text-muted-foreground ml-2 text-xs">sistema</span>
            ) : null}
          </p>
          <p className="text-muted-foreground truncate text-xs">{row.slug}</p>
        </div>
      ),
      mobile: (row) => row.name,
    },
    {
      key: "scope",
      header: "Escopo",
      cell: (row) => (
        <Badge variant={row.scope === "ALL_BRANCHES" ? "default" : "secondary"}>
          {row.scope === "ALL_BRANCHES" ? "Toda a rede" : "Somente a unidade"}
        </Badge>
      ),
    },
    {
      key: "permissions",
      header: "Permissões",
      align: "right",
      cell: (row) => <span className="text-sm">{row._count.rolePermissions}</span>,
    },
    {
      key: "memberships",
      header: "Usuários",
      align: "right",
      cell: (row) => <span className="text-sm">{row._count.memberships}</span>,
    },
    {
      key: "active",
      header: "Situação",
      cell: (row) => (
        <Badge variant={row.active ? "secondary" : "outline"}>
          {row.active ? "Ativo" : "Inativo"}
        </Badge>
      ),
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title="Perfis e permissões"
        description="Perfis são dados: criar ou ajustar permissões não exige novo deploy."
        action={
          canManage ? (
            <Button asChild>
              <Link href="/admin/papeis/novo">
                <Plus className="size-4" />
                Novo perfil
              </Link>
            </Button>
          ) : null
        }
      />

      <DataTable
        columns={columns}
        rows={roles}
        getRowId={(row) => row.id}
        basePath="/admin/papeis"
        searchParams={{}}
        page={1}
        pageSize={roles.length || 1}
        total={roles.length}
        totalPages={1}
        rowHref={(row) => `/admin/papeis/${row.id}`}
        emptyTitle="Nenhum perfil cadastrado"
        emptyDescription="Rode o seed para criar os perfis de sistema."
      />

      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <ShieldCheck className="size-4" />
        Perfis de sistema não podem ser excluídos, apenas ajustados. Ao alterar um perfil, a nova
        permissão passa a valer no próximo acesso dos usuários vinculados.
      </p>
    </PageBody>
  );
}
