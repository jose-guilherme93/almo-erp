import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { MaintenanceForm } from "@/components/domain/maintenance-form";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/guards";
import { listRequestableBranchesForMaintenance } from "@/server/services/maintenance";
import { listActiveSectors } from "@/server/services/sector";
import { firstParam, type RawSearchParams } from "@/lib/pagination";
import { MAINTENANCE_CATEGORIES } from "@/lib/validation/maintenance";

export const metadata: Metadata = {
  title: "Abrir chamado de reparo",
};

export default async function NovoReparoPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const context = await requirePagePermission("manutencao:create");

  const [branches, sectors] = await Promise.all([
    listRequestableBranchesForMaintenance(context),
    listActiveSectors(),
  ]);

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

  // Atalho "Chamado de TI": chega com a categoria pré-selecionada.
  const requestedCategory = firstParam(params, "categoria");
  const defaultCategory = MAINTENANCE_CATEGORIES.some((entry) => entry.value === requestedCategory)
    ? (requestedCategory as string)
    : "";

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
          <MaintenanceForm
            branches={branches}
            defaultBranchId={defaultBranchId}
            sectors={sectors.map((sector) => ({
              id: sector.id,
              code: sector.code,
              name: sector.name,
            }))}
            defaultSectorId={defaultSectorId}
            defaultCategory={defaultCategory}
          />
        </CardContent>
      </Card>
    </PageBody>
  );
}
