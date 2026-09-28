import type { Metadata } from "next";

import { UnitManager } from "@/components/domain/unit-manager";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/guards";
import { listUnits } from "@/server/services/catalog/unit";

export const metadata: Metadata = {
  title: "Unidades de medida",
};

export default async function UnidadesPage() {
  const context = await requirePagePermission("unidade-medida:read");
  const units = await listUnits();

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title="Unidades de medida"
        description="Como cada material é contado: unidade, caixa, quilo, litro…"
      />

      <Card>
        <CardHeader>
          <CardTitle>Unidades cadastradas</CardTitle>
          <CardDescription>
            Unidades padrão não podem ser desativadas nem ter o código alterado — elas aparecem em
            relatórios históricos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UnitManager
            canManage={context.hasPermission("unidade-medida:manage")}
            units={units.map((unit) => ({
              id: unit.id,
              code: unit.code,
              name: unit.name,
              allowsDecimals: unit.allowsDecimals,
              isSystem: unit.isSystem,
              active: unit.active,
              itemCount: unit._count.items,
            }))}
          />
        </CardContent>
      </Card>
    </PageBody>
  );
}
