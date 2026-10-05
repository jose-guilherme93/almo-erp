import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import {
  MembershipManager,
  UserDetailsForm,
  UserStatusActions,
} from "@/components/domain/user-detail-panels";
import { statusBadge, USER_STATUS } from "@/components/domain/status-badge";
import { SuccessCallout, successMessageFrom } from "@/components/domain/success-callout";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { RawSearchParams } from "@/lib/pagination";
import { prisma } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { requirePagePermission } from "@/server/auth/guards";
import { listAuditTrail } from "@/server/services/audit";
import { listActiveSectors } from "@/server/services/sector";
import { getUserDetail } from "@/server/services/user";

export const metadata: Metadata = {
  title: "Detalhe do usuário",
};

type UsuarioPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
};

export default async function UsuarioDetalhePage({ params, searchParams }: UsuarioPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const context = await requirePagePermission("usuario:read");

  let user: Awaited<ReturnType<typeof getUserDetail>>;

  try {
    user = await getUserDetail(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  const canManage = context.hasPermission("usuario:manage", user.memberships[0]?.branch.id);

  const successMessage = successMessageFrom(query, {
    criado: "Usuário cadastrado. Ele entra com a conta Google usando este e-mail.",
  });

  const [branches, roles, sectors, audit] = await Promise.all([
    prisma.branch.findMany({
      where: { active: true, id: { in: context.branchIds } },
      orderBy: [{ type: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, type: true },
    }),
    canManage
      ? prisma.role.findMany({
          where: { active: true },
          orderBy: [{ scope: "asc" }, { name: "asc" }],
          select: { id: true, name: true, scope: true },
        })
      : Promise.resolve([]),
    listActiveSectors(),
    listAuditTrail({ entityType: "User", entityId: id, limit: 20 }),
  ]);

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title={user.name}
        description={user.email}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/usuarios">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      {successMessage ? <SuccessCallout message={successMessage} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {statusBadge(USER_STATUS, user.status)}
        {!user.active ? (
          <span className="text-muted-foreground text-sm">conta desabilitada</span>
        ) : null}
        <span className="text-muted-foreground text-sm">
          {user.lastLoginAt
            ? `Último acesso ${formatRelative(user.lastLoginAt)}`
            : "Nunca acessou o sistema"}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dados cadastrais</CardTitle>
            {user.approvedBy ? (
              <CardDescription>
                Aprovado por {user.approvedBy.name} em{" "}
                {formatDateTime(user.approvedAt ?? user.createdAt)}
              </CardDescription>
            ) : (
              <CardDescription>Criado em {formatDateTime(user.createdAt)}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <UserDetailsForm userId={user.id} name={user.name} active={user.active} />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Status de acesso</CardTitle>
              <CardDescription>
                Aprovar libera o login; suspender derruba o acesso imediatamente.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UserStatusActions userId={user.id} status={user.status} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Convites</CardTitle>
              <CardDescription>Últimos convites emitidos para este e-mail.</CardDescription>
            </CardHeader>
            <CardContent>
              {user.invitesSent.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nenhum convite emitido.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {user.invitesSent.map((invite) => (
                    <li key={invite.id} className="flex items-center justify-between gap-2 py-2">
                      <span className="text-muted-foreground">
                        {invite.branch.code} · {invite.role.name}
                      </span>
                      <span className="text-xs">
                        {invite.status === "PENDING"
                          ? `expira ${formatRelative(invite.expiresAt)}`
                          : invite.status.toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vínculos com unidades</CardTitle>
          <CardDescription>
            O perfil de cada vínculo define o que a pessoa pode fazer naquela unidade.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MembershipManager
            userId={user.id}
            memberships={user.memberships.map((membership) => ({
              id: membership.id,
              active: membership.active,
              isDefault: membership.isDefault,
              branchId: membership.branch.id,
              branchName: membership.branch.name,
              branchCode: membership.branch.code,
              roleId: membership.role.id,
              roleName: membership.role.name,
              sectorId: membership.sector?.id ?? null,
              sectorName: membership.sector?.name ?? null,
            }))}
            branches={branches.map((branch) => ({ id: branch.id, name: branch.name }))}
            roles={roles.map((role) => ({
              id: role.id,
              name: role.name,
              scope: role.scope,
            }))}
            sectors={sectors.map((sector) => ({ id: sector.id, name: sector.name }))}
            canManage={canManage}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
          <CardDescription>Alterações registradas na auditoria.</CardDescription>
        </CardHeader>
        <CardContent>
          {audit.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma alteração registrada.</p>
          ) : (
            <ul className="divide-y text-sm">
              {audit.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                >
                  <span>
                    <span className="font-medium">{entry.action}</span>
                    {entry.actor ? (
                      <span className="text-muted-foreground"> por {entry.actor.name}</span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {formatDateTime(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageBody>
  );
}
