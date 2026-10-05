import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { UserForm } from "@/components/domain/user-form";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/server/auth/guards";
import { listActiveSectors } from "@/server/services/sector";

export const metadata: Metadata = {
  title: "Novo usuário",
};

export default async function NovoUsuarioPage() {
  const context = await requirePagePermission("usuario:manage");

  const [roles, branches, sectors] = await Promise.all([
    prisma.role.findMany({
      where: { active: true },
      orderBy: [{ scope: "asc" }, { name: "asc" }],
      select: { id: true, name: true, scope: true, description: true },
    }),
    prisma.branch.findMany({
      where: { active: true, id: { in: context.branchIds } },
      orderBy: [{ type: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, type: true },
    }),
    listActiveSectors(),
  ]);

  return (
    <PageBody className="max-w-3xl">
      <PageHeader
        title="Novo usuário"
        description="Cadastre quem pode acessar o sistema e com qual perfil."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/usuarios">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent>
          <UserForm
            roles={roles}
            branches={branches}
            sectors={sectors.map((sector) => ({
              id: sector.id,
              code: sector.code,
              name: sector.name,
            }))}
            canActivateDirectly={context.hasPermission("usuario:manage")}
          />
        </CardContent>
      </Card>
    </PageBody>
  );
}
