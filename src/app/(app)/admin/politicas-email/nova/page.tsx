import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { EmailPolicyForm } from "@/components/domain/email-policy-form";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/server/auth/guards";

export const metadata: Metadata = {
  title: "Nova política de e-mail",
};

export default async function NovaPoliticaEmailPage() {
  await requirePagePermission("politica-email:manage");

  const [roles, branches] = await Promise.all([
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
  ]);

  return (
    <PageBody className="max-w-2xl">
      <PageHeader
        title="Nova política de e-mail"
        description="Define quem do domínio pode entrar e como o acesso é liberado."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/politicas-email">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent>
          <EmailPolicyForm mode="create" roles={roles} branches={branches} />
        </CardContent>
      </Card>
    </PageBody>
  );
}
