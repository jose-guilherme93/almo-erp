import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { InventoryCreateForm } from "@/components/domain/inventory-create-form";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/server/auth/guards";
import { resolveWorkingBranch } from "@/server/auth/scope";

export const metadata: Metadata = {
  title: "Novo inventário",
};

export default async function NovoInventarioPage() {
  const context = await requirePagePermission("inventario:manage");
  const branchId = resolveWorkingBranch(context, null);

  const [locations, categories] = await Promise.all([
    prisma.storageLocation.findMany({
      where: { branchId, active: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.category.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const branch = context.getMembership(branchId);

  return (
    <PageBody className="max-w-2xl">
      <PageHeader
        title="Novo inventário"
        description="Escolha o escopo da contagem. Um recorte bem feito é mais rápido e mais confiável."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/inventario">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Escopo da contagem</CardTitle>
          <CardDescription>
            Unidade ativa: <span className="font-medium">{branch?.branchName}</span>. Sem filtro, o
            inventário cobre todo o estoque da unidade.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InventoryCreateForm branchId={branchId} locations={locations} categories={categories} />
        </CardContent>
      </Card>
    </PageBody>
  );
}
