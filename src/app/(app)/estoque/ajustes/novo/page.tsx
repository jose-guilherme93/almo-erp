import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { StockDocumentForm } from "@/components/domain/stock-document-form";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/server/auth/guards";
import { resolveWorkingBranch } from "@/server/auth/scope";
import { listActiveLots } from "@/server/services/stock/lots";

export const metadata: Metadata = {
  title: "Novo ajuste",
};

export default async function NovoAjustePage() {
  const context = await requirePagePermission("estoque:ajuste");
  const branchId = resolveWorkingBranch(context, null);

  const [locations, lots] = await Promise.all([
    prisma.storageLocation.findMany({
      where: { branchId, active: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    listActiveLots(branchId),
  ]);

  const branch = context.getMembership(branchId);

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title="Novo ajuste"
        description="Use quantidade negativa para reduzir o saldo e positiva para aumentar."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/estoque/ajustes">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Motivo e materiais</CardTitle>
          <CardDescription>
            A justificativa é obrigatória e vai para a auditoria junto com o saldo anterior.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StockDocumentForm
            mode="adjustment"
            locations={locations}
            branchCode={branch?.branchCode ?? ""}
            defaultLocationId={locations[0]?.id ?? null}
            lots={lots}
          />
        </CardContent>
      </Card>
    </PageBody>
  );
}
