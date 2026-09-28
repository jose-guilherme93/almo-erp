import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { MaintenanceForm } from "@/components/domain/maintenance-form";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/guards";
import { listRequestableBranchesForMaintenance } from "@/server/services/maintenance";

export const metadata: Metadata = {
  title: "Abrir chamado de reparo",
};

export default async function NovoReparoPage() {
  const context = await requirePagePermission("manutencao:create");

  const branches = await listRequestableBranchesForMaintenance(context);

  const defaultBranchId =
    context.activeBranchId && branches.some((branch) => branch.id === context.activeBranchId)
      ? context.activeBranchId
      : (branches[0]?.id ?? "");

  return (
    <PageBody className="max-w-2xl">
      <PageHeader
        title="Abrir chamado de reparo"
        description="Descreva o problema. A manutenção da unidade é avisada na hora."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/reparos">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>O problema</CardTitle>
          <CardDescription>
            Quanto mais claro o local e a descrição, mais rápido o conserto. A equipe não precisa
            ligar para entender.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MaintenanceForm branches={branches} defaultBranchId={defaultBranchId} />
        </CardContent>
      </Card>
    </PageBody>
  );
}
