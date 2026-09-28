import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { EmailPolicyForm } from "@/components/domain/email-policy-form";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { requirePagePermission } from "@/server/auth/guards";
import { countDomainUsage, getEmailPolicy } from "@/server/services/email-policy";

export const metadata: Metadata = {
  title: "Editar política de e-mail",
};

type PoliticaPageProps = {
  params: Promise<{ id: string }>;
};

export default async function PoliticaEmailDetalhePage({ params }: PoliticaPageProps) {
  const { id } = await params;
  await requirePagePermission("politica-email:manage");

  let policy: Awaited<ReturnType<typeof getEmailPolicy>>;

  try {
    policy = await getEmailPolicy(id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const [roles, branches, usage] = await Promise.all([
    prisma.role.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.branch.findMany({
      where: { active: true },
      orderBy: { code: "asc" },
      select: { id: true, name: true },
    }),
    countDomainUsage(policy.domain),
  ]);

  return (
    <PageBody className="max-w-2xl">
      <PageHeader
        title={policy.domain}
        description="Ajuste a regra de acesso deste domínio."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/politicas-email">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge variant={policy.active ? "secondary" : "outline"}>
          {policy.active ? "Ativa" : "Inativa"}
        </Badge>
        <Badge variant={policy.autoApprove ? "default" : "secondary"}>
          {policy.autoApprove ? "Aprovação automática" : "Aprovação manual"}
        </Badge>
        <Badge variant="outline">{usage.users} usuário(s)</Badge>
        <Badge variant="outline">{usage.invites} convite(s)</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Regra de acesso</CardTitle>
          <CardDescription>
            Mudanças aqui valem no próximo login — sessões já abertas são reavaliadas a cada
            requisição.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmailPolicyForm
            mode="edit"
            policyId={policy.id}
            roles={roles}
            branches={branches}
            defaultValues={{
              domain: policy.domain,
              pattern: policy.pattern,
              autoApprove: policy.autoApprove,
              defaultRoleId: policy.defaultRoleId,
              defaultBranchId: policy.defaultBranchId,
              active: policy.active,
            }}
          />
        </CardContent>
      </Card>
    </PageBody>
  );
}
