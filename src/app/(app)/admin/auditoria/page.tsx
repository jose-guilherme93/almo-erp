import type { Metadata } from "next";

import { DataTable, type Column } from "@/components/data-table/data-table";
import {
  ClearFilters,
  TableFilterSelect,
  TableSearch,
} from "@/components/data-table/table-filters";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { listAuditEntries } from "@/server/services/config";

export const metadata: Metadata = {
  title: "Auditoria",
};

type Row = Awaited<ReturnType<typeof listAuditEntries>>["items"][number];

/**
 * Trilha de auditoria.
 *
 * Só leitura, por definição: `AuditLog` é append-only e não tem rota de
 * edição nem de remoção (AGENTS.md §11).
 */
export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const context = await requirePagePermission("papel:manage");

  const result = await listAuditEntries(context, {
    action: readSearch(params) || null,
    entityType: firstParam(params, "entidade") ?? null,
    actorId: firstParam(params, "autor") ?? null,
    page: readPage(params),
    pageSize: readPageSize(params),
  });

  const actors = await prisma.user.findMany({
    where: { auditLogs: { some: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
    take: 100,
  });

  const columns: Array<Column<Row>> = [
    {
      key: "createdAt",
      header: "Quando",
      cell: (row) => (
        <span className="text-muted-foreground text-sm">{formatDateTime(row.createdAt)}</span>
      ),
    },
    {
      key: "action",
      header: "Ação",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.action}</p>
          <p className="text-muted-foreground truncate font-mono text-xs">
            {row.entityType}
            {row.entityId ? ` · ${row.entityId.slice(0, 8)}…` : ""}
          </p>
        </div>
      ),
      mobile: (row) => row.action,
    },
    {
      key: "actor",
      header: "Quem",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{row.actor?.name ?? "sistema"}</p>
          <p className="text-muted-foreground truncate text-xs">{row.actor?.email ?? ""}</p>
        </div>
      ),
    },
    {
      key: "branch",
      header: "Unidade",
      cell: (row) =>
        row.branch ? (
          <span className="text-sm">{row.branch.code}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      key: "ip",
      header: "IP",
      cell: (row) => (
        <span className="text-muted-foreground font-mono text-xs">{row.ip ?? "—"}</span>
      ),
    },
    {
      key: "appVersion",
      header: "Versão",
      cell: (row) => (
        <span className="text-muted-foreground font-mono text-xs">{row.appVersion ?? "—"}</span>
      ),
      mobile: (row) => row.appVersion ?? "—",
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title="Auditoria"
        description="Quem fez o quê, quando e de onde. Registro imutável."
      />

      <p className="text-muted-foreground text-xs">
        A trilha é gravada junto com cada operação e não pode ser editada nem apagada — inclusive
        pelos administradores. Valores sensíveis (tokens e assinaturas) são omitidos no registro.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <TableSearch paramKey="busca" placeholder="Buscar por ação…" />

        <TableFilterSelect
          paramKey="entidade"
          placeholder="Entidade"
          allLabel="Todas as entidades"
          options={result.entityTypes.map((type) => ({ value: type, label: type }))}
        />

        <TableFilterSelect
          paramKey="autor"
          placeholder="Autor"
          allLabel="Todos os autores"
          options={actors.map((actor) => ({ value: actor.id, label: actor.name }))}
        />

        <ClearFilters paramKeys={["busca", "entidade", "autor"]} />
      </div>

      <DataTable
        columns={columns}
        rows={result.items}
        getRowId={(row) => row.id}
        basePath="/admin/auditoria"
        searchParams={params}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        emptyTitle="Nenhum registro encontrado"
        emptyDescription={
          readSearch(params)
            ? "Ajuste os filtros para ver mais resultados."
            : "As operações passam a aparecer aqui conforme são executadas."
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>O que é registrado</CardTitle>
          <CardDescription>
            Toda ação de escrita, com o estado anterior e o posterior quando faz sentido.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-2">
            <li>Criação e alteração de usuários, vínculos e perfis</li>
            <li>Políticas de e-mail e configurações do sistema</li>
            <li>Filial, locais de estoque, materiais e mínimos</li>
            <li>Entradas, ajustes e cancelamento de movimentação</li>
            <li>Transferências, solicitações e entregas</li>
            <li>Contagem e ajuste de inventário</li>
          </ul>
        </CardContent>
      </Card>
    </PageBody>
  );
}
