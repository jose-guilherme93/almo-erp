import type { Metadata } from "next";

import { DataTable, type Column } from "@/components/data-table/data-table";
import {
  ClearFilters,
  TableFilterSelect,
  TableSearch,
} from "@/components/data-table/table-filters";
import { ErrorLogActions } from "@/components/domain/error-log-actions";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatRelative } from "@/lib/format";
import {
  firstParam,
  readPage,
  readPageSize,
  readSearch,
  type RawSearchParams,
} from "@/lib/pagination";
import { requirePagePermission } from "@/server/auth/guards";
import { listErrorLogs, listErrorRoutes } from "@/server/services/error-log";

export const metadata: Metadata = {
  title: "Erros",
};

type Row = Awaited<ReturnType<typeof listErrorLogs>>["items"][number];

type ErrosPageProps = {
  searchParams: Promise<RawSearchParams>;
};

const ROUTE_TYPE_LABEL: Record<string, string> = {
  render: "render",
  route: "rota",
  action: "action",
  proxy: "proxy",
  log: "log",
  process: "processo",
};

/**
 * Erros de servidor capturados.
 *
 * Uma linha por erro **único**, não por ocorrência: `count` diz quantas vezes
 * aconteceu. É o que evita que um erro em render alcançado por vários usuários
 * vire uma parede de linhas.
 *
 * Busca por `digest` é o caminho do suporte: o usuário viu "Referência: abc123"
 * na tela, digita aqui e descobre o que aconteceu e desde quando.
 */
export default async function ErrosPage({ searchParams }: ErrosPageProps) {
  const params = await searchParams;
  await requirePagePermission("papel:manage");

  const search = readSearch(params);
  const routePath = firstParam(params, "rota") ?? null;
  const onlyOpen = firstParam(params, "situacao") !== "todos";

  const [result, routes] = await Promise.all([
    listErrorLogs({
      search,
      routePath,
      onlyOpen,
      page: readPage(params),
      pageSize: readPageSize(params),
    }),
    listErrorRoutes(),
  ]);

  const columns: Array<Column<Row>> = [
    {
      key: "message",
      header: "Erro",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.message}</p>
          <p className="text-muted-foreground truncate font-mono text-xs">
            {row.routePath}
            {row.method ? ` · ${row.method}` : ""} ·{" "}
            {ROUTE_TYPE_LABEL[row.routeType] ?? row.routeType}
          </p>
        </div>
      ),
      mobile: (row) => row.message,
    },
    {
      key: "count",
      header: "Vezes",
      align: "right",
      cell: (row) => (
        <Badge variant={row.count > 1 ? "destructive" : "secondary"}>{row.count}x</Badge>
      ),
    },
    {
      key: "digest",
      header: "Referência",
      cell: (row) =>
        row.digest ? (
          <span className="font-mono text-xs">{row.digest.slice(0, 12)}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
    },
    {
      key: "lastSeenAt",
      header: "Última vez",
      cell: (row) => (
        <div className="min-w-0">
          <p className="text-sm">{formatRelative(row.lastSeenAt)}</p>
          <p className="text-muted-foreground text-xs">{formatDateTime(row.lastSeenAt)}</p>
        </div>
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
    {
      key: "status",
      header: "Situação",
      cell: (row) => <ErrorLogActions errorLogId={row.id} resolved={row.resolvedAt !== null} />,
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title="Erros"
        description={`${result.openCount} erro(s) em aberto. Capturado de render, rotas e actions.`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <TableSearch paramKey="busca" placeholder="Buscar por mensagem ou referência…" />

        <TableFilterSelect
          paramKey="rota"
          placeholder="Rota"
          allLabel="Todas as rotas"
          options={routes.map((route) => ({ value: route, label: route }))}
        />

        <TableFilterSelect
          paramKey="situacao"
          placeholder="Situação"
          allLabel="Todos, inclusive resolvidos"
          options={[{ value: "abertos", label: "Só em aberto" }]}
        />

        <ClearFilters paramKeys={["busca", "rota", "situacao"]} />
      </div>

      <DataTable
        columns={columns}
        rows={result.items}
        getRowId={(row) => row.id}
        basePath="/admin/erros"
        searchParams={params}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        totalPages={result.totalPages}
        emptyTitle="Nenhum erro registrado"
        emptyDescription={
          search || routePath
            ? "Ajuste os filtros para ver mais resultados."
            : "Nenhum erro de servidor desde o último deploy."
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Como isto funciona</CardTitle>
          <CardDescription>
            O Next entrega ao servidor todo erro de render, rota e action. O erro vira uma linha
            aqui, e a mesma falha não abre uma linha nova: ela soma em &ldquo;Vezes&rdquo;.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-2">
            <li>
              <strong>Referência</strong> é o código que o usuário viu na tela — digite na busca
            </li>
            <li>Erro repetido soma em &ldquo;Vezes&rdquo;; não vira linha nova</li>
            <li>Notificação no sino só na primeira ocorrência</li>
            <li>Marcar como resolvido esconde da fila, mas não apaga o histórico</li>
            <li>Mensagem e stack omitem linhas que possam conter credencial</li>
            <li>O registro no banco e o log do container são complements</li>
          </ul>
        </CardContent>
      </Card>
    </PageBody>
  );
}
