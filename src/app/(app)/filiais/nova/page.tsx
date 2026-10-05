import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { BranchForm } from "@/components/domain/branch-form";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/server/auth/guards";
import { listBranchOptions } from "@/server/services/branch";

export const metadata: Metadata = {
  title: "Nova unidade",
};

export default async function NovaFilialPage() {
  const context = await requirePagePermission("filial:create");

  const [people, branches] = await Promise.all([
    prisma.user.findMany({
      where: { status: "ACTIVE", active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    listBranchOptions(context),
  ]);

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title="Nova unidade"
        description="Cadastro completo de matriz ou filial, com endereço e responsáveis."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/filiais">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Dados da unidade</CardTitle>
          <CardDescription>
            Apenas código, nome e CNPJ são obrigatórios. Os demais dados podem ser completados
            depois.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BranchForm mode="create" people={people} branches={branches} />
        </CardContent>
      </Card>
    </PageBody>
  );
}
