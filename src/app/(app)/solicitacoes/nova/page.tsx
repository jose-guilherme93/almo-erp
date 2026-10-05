import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { RequestForm } from "@/components/domain/request-form";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/guards";
import { listRequestableBranches } from "@/server/services/request";
import { listActiveSectors } from "@/server/services/sector";

export const metadata: Metadata = {
  title: "Solicitar material",
};

/**
 * Tela de solicitação de material.
 *
 * Qualquer usuário logado pode abrir. A unidade é escolhida aqui, entre todas
 * as unidades ativas — quem responde ao pedido é quem cuida daquela unidade.
 */
export default async function NovaSolicitacaoPage() {
  const context = await requirePagePermission("solicitacao:create");

  const [branches, sectors] = await Promise.all([
    listRequestableBranches(context),
    listActiveSectors(),
  ]);

  // Pré-seleciona a unidade em que o usuário já está operando, quando houver.
  const defaultBranchId =
    context.activeBranchId && branches.some((branch) => branch.id === context.activeBranchId)
      ? context.activeBranchId
      : (branches[0]?.id ?? "");

  const defaultSectorId =
    (context.activeSectorId &&
      sectors.some((sector) => sector.id === context.activeSectorId) &&
      context.activeSectorId) ||
    sectors[0]?.id ||
    "";

  return (
    <PageBody className="max-w-3xl">
      <PageHeader
        title="Pedir material"
        description="Adicione os materiais e envie. Vai direto para quem responde."
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
            Busque pelo nome do material ou use o leitor de código de barras. Você acompanha o
            andamento e é avisado quando for aprovado ou entregue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RequestForm
            branches={branches}
            defaultBranchId={defaultBranchId}
            sectors={sectors.map((sector) => ({
              id: sector.id,
              code: sector.code,
              name: sector.name,
            }))}
            defaultSectorId={defaultSectorId}
          />
        </CardContent>
      </Card>
    </PageBody>
  );
}
