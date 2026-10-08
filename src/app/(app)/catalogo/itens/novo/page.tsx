import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ItemForm } from "@/components/domain/item-form";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/guards";
import { ensureGeneralCategory, listCategoryOptions } from "@/server/services/catalog/category";
import { listUnits } from "@/server/services/catalog/unit";

export const metadata: Metadata = {
  title: "Novo material",
};

export default async function NovoItemPage() {
  await requirePagePermission("item:create");

  const [units, categories, general] = await Promise.all([
    listUnits({ onlyActive: true }),
    listCategoryOptions(),
    ensureGeneralCategory(),
  ]);

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title="Novo material"
        description="Nome e unidade bastam. O resto é opcional."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/catalogo/itens">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Dados do material</CardTitle>
          <CardDescription>
            O código é gerado sozinho e a categoria já vem preenchida. Na doca, nem precisa vir
            aqui: a leitura do código de barras cadastra o material direto na entrada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ItemForm
            mode="create"
            units={units.map((unit) => ({ id: unit.id, name: unit.name, code: unit.code }))}
            categories={categories.map((category) => ({
              id: category.id,
              label: category.label,
              requiresApproval: category.requiresApproval,
            }))}
            defaultCategoryId={general.id}
            defaultValues={{
              code: null,
              barcode: null,
              name: "",
              description: null,
              unitId: "",
              referencePrice: "0.00",
              controlledByLot: false,
              perishable: false,
              requiresApproval: false,
              hasSerialControl: false,
              trackAsAsset: true,
              active: true,
            }}
          />
        </CardContent>
      </Card>
    </PageBody>
  );
}
