import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { RequestForm } from "@/components/domain/request-form";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/guards";
import { resolveWorkingBranch } from "@/server/auth/scope";

export const metadata: Metadata = {
  title: "Nova solicitação",
};

export default async function NovaSolicitacaoPage() {
  const context = await requirePagePermission("solicitacao:create");
  const branchId = resolveWorkingBranch(context, null);
  const branch = context.getMembership(branchId);

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title="Solicitar material"
        description="Peça o que você precisa do almoxarifado da sua unidade."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/meu">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>O que você precisa</CardTitle>
          <CardDescription>
            Busque pelo nome do material ou leia o código de barras. Você acompanha o status do
            pedido e é avisado quando estiver pronto para retirada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RequestForm branchId={branchId} branchCode={branch?.branchCode ?? ""} />
        </CardContent>
      </Card>
    </PageBody>
  );
}
