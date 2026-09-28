import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { DataTable, type Column } from "@/components/data-table/data-table";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SuccessCallout, successMessageFrom } from "@/components/domain/success-callout";
import { formatDateTime } from "@/lib/format";
import type { RawSearchParams } from "@/lib/pagination";
import { env } from "@/lib/env";
import { requirePagePermission } from "@/server/auth/guards";
import { listEmailPoliciesWithUsage } from "@/server/services/email-policy";

export const metadata: Metadata = {
  title: "Políticas de e-mail",
};

type Row = Awaited<ReturnType<typeof listEmailPoliciesWithUsage>>[number];

type PoliticasPageProps = {
  searchParams: Promise<RawSearchParams>;
};

export default async function PoliticasEmailPage({ searchParams }: PoliticasPageProps) {
  await requirePagePermission("politica-email:read");

  const query = await searchParams;
  const successMessage = successMessageFrom(query, {
    criada: "Política criada.",
    salva: "Política atualizada.",
  });

  const policies = await listEmailPoliciesWithUsage();
  const environmentDomains = env.AUTH_ALLOWED_DOMAINS;

  const columns: Array<Column<Row>> = [
    {
      key: "domain",
      header: "Domínio",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.domain}</p>
          {row.pattern ? (
            <p className="text-muted-foreground truncate font-mono text-xs">{row.pattern}</p>
          ) : (
            <p className="text-muted-foreground text-xs">Todo o domínio</p>
          )}
        </div>
      ),
      mobile: (row) => row.domain,
    },
    {
      key: "autoApprove",
      header: "Aprovação",
      cell: (row) => (
        <Badge variant={row.autoApprove ? "default" : "secondary"}>
          {row.autoApprove ? "Automática" : "Manual"}
        </Badge>
      ),
    },
    {
      key: "defaults",
      header: "Padrão no auto-aprovar",
      cell: (row) => (
        <span className="text-sm">
          {row.autoApprove
            ? [row.defaultRole?.name, row.defaultBranch?.code].filter(Boolean).join(" · ") || "—"
            : "—"}
        </span>
      ),
    },
    {
      key: "usage",
      header: "Usuários",
      align: "right",
      cell: (row) => (
        <span className="text-sm">
          {row.usage.users}
          <span className="text-muted-foreground"> ({row.usage.invites} convites)</span>
        </span>
      ),
    },
    {
      key: "active",
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
        title="Políticas de e-mail"
        description="Quem pode entrar no sistema e como o acesso é liberado."
        action={
          <Button asChild>
            <Link href="/admin/politicas-email/nova">
              <Plus className="size-4" />
              Nova política
            </Link>
          </Button>
        }
      />

      {successMessage ? <SuccessCallout message={successMessage} /> : null}

      {environmentDomains.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Domínios liberados por configuração</CardTitle>
            <CardDescription>
              Vêm da variável de ambiente{" "}
              <code className="font-mono text-xs">AUTH_ALLOWED_DOMAINS</code> e somam-se às
              políticas abaixo. Para remover, é preciso alterar a configuração do servidor — o que
              está aqui na tela pode ser ligado e desligado sem deploy.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {environmentDomains.map((domain) => (
                <Badge key={domain} variant="outline">
                  {domain}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <DataTable
        columns={columns}
        rows={policies}
        getRowId={(row) => row.id}
        basePath="/admin/politicas-email"
        searchParams={{}}
        page={1}
        pageSize={policies.length || 1}
        total={policies.length}
        totalPages={1}
        rowHref={(row) => `/admin/politicas-email/${row.id}`}
        emptyTitle="Nenhuma política cadastrada"
        emptyDescription={
          environmentDomains.length > 0
            ? "Os domínios da configuração do servidor continuam valendo. Cadastre uma política para aplicar regras por e-mail ou auto-aprovar."
            : "Sem política e sem domínio configurado, ninguém consegue entrar no sistema."
        }
        emptyAction={
          <Button asChild variant="outline">
            <Link href="/admin/politicas-email/nova">Criar política</Link>
          </Button>
        }
      />

      <p className="text-muted-foreground text-xs">
        Última atualização:{" "}
        {policies[0] ? formatDateTime(policies[0].updatedAt) : "nenhuma política cadastrada"}.
      </p>
    </PageBody>
  );
}
