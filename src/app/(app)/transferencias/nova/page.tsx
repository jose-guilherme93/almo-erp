import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { TransferForm } from "@/components/domain/transfer-form";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/server/auth/guards";
import { resolveWorkingBranch } from "@/server/auth/scope";

export const metadata: Metadata = {
  title: "Nova transferência",
};

export default async function NovaTransferenciaPage() {
  const context = await requirePagePermission("transferencia:create");
  const branchId = resolveWorkingBranch(context, null);

  const destinations = await prisma.branch.findMany({
    where: { active: true, id: { not: branchId } },
    orderBy: [{ type: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true },
  });

  const origin = context.getMembership(branchId);

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title="Nova transferência"
        description="Envie material da sua unidade para outra."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/transferencias">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      {destinations.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nenhuma unidade de destino disponível</CardTitle>
            <CardDescription>
              É preciso existir pelo menos uma outra unidade ativa para transferir.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Dados da transferência</CardTitle>
            <CardDescription>
              Escolha o destino e os materiais. O saldo da origem é conferido no momento do envio.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TransferForm
              originBranchId={branchId}
              originBranchCode={origin?.branchCode ?? ""}
              destinations={destinations}
            />
          </CardContent>
        </Card>
      )}
    </PageBody>
  );
}
