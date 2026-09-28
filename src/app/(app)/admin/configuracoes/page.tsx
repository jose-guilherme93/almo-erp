import type { Metadata } from "next";
import { Settings } from "lucide-react";

import { ConfigForm } from "@/components/domain/config-form";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/guards";
import { listConfigs } from "@/server/services/config";

export const metadata: Metadata = {
  title: "Configurações",
};

/** Parâmetros operacionais ajustáveis sem deploy. */
export default async function ConfiguracoesPage() {
  await requirePagePermission("configuracao:manage");

  const configs = await listConfigs();

  return (
    <PageBody className="max-w-2xl">
      <PageHeader
        title="Configurações"
        description="Parâmetros operacionais do sistema. Toda alteração fica na auditoria."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="size-5" aria-hidden />
            Parâmetros
          </CardTitle>
          <CardDescription>
            Valores aplicados no próximo acesso. Nenhum deles exige reiniciar o sistema.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConfigForm
            fields={configs.map((config) => ({
              key: config.key,
              label: config.label,
              description: config.description,
              type: config.type,
              value: config.value,
              updatedByName: config.updatedByName,
            }))}
          />
        </CardContent>
      </Card>
    </PageBody>
  );
}
