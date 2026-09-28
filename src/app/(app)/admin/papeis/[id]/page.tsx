import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { RoleForm } from "@/components/domain/role-form";
import { SuccessCallout, successMessageFrom } from "@/components/domain/success-callout";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isAppError } from "@/lib/errors";
import type { RawSearchParams } from "@/lib/pagination";
import { requirePagePermission } from "@/server/auth/guards";
import { getRole } from "@/server/services/role";

export const metadata: Metadata = {
  title: "Editar perfil",
};

type PapelPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
};

export default async function PapelDetalhePage({ params, searchParams }: PapelPageProps) {
  const { id } = await params;
  const query = await searchParams;
  await requirePagePermission("papel:manage");

  let role: Awaited<ReturnType<typeof getRole>>;

  try {
    role = await getRole(id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const successMessage = successMessageFrom(query, {
    criado: "Perfil criado.",
    salvo: "Permissões atualizadas. Já valem no próximo acesso dos usuários vinculados.",
  });

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title={role.name}
        description={`${role._count.memberships} usuário(s) com este perfil.`}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/papeis">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      {successMessage ? <SuccessCallout message={successMessage} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={role.scope === "ALL_BRANCHES" ? "default" : "secondary"}>
          {role.scope === "ALL_BRANCHES" ? "Toda a rede" : "Somente a unidade"}
        </Badge>
        {role.isSystem ? (
          <Badge variant="outline">Perfil de sistema</Badge>
        ) : (
          <Badge variant="outline">Perfil customizado</Badge>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Permissões</CardTitle>
          <CardDescription>
            As alterações passam a valer quando cada usuário faz a próxima requisição — não é
            preciso esperar o token expirar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RoleForm
            mode="edit"
            roleId={role.id}
            isSystem={role.isSystem}
            defaultValues={{
              name: role.name,
              description: role.description,
              scope: role.scope,
              permissionKeys: role.permissionKeys,
            }}
          />
        </CardContent>
      </Card>
    </PageBody>
  );
}
