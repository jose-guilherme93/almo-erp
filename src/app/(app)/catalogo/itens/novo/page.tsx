import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ItemForm } from "@/components/domain/item-form";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/server/auth/guards";
import { listCategoryOptions } from "@/server/services/catalog/category";
import { listUnits } from "@/server/services/catalog/unit";

export const metadata: Metadata = {
  title: "Novo material",
};

export default async function NovoItemPage() {
  await requirePagePermission("item:create");

  const [units, categories] = await Promise.all([
    listUnits({ onlyActive: true }),
    listCategoryOptions(),
  ]);

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title="Novo material"
        description="Cadastre o material no catálogo do almoxarifado."
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
            O código pode ser gerado automaticamente. O código de barras é opcional, mas sem ele o
            leitor não encontra o material no balcão.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ItemForm
            mode="create"
            units={units.map((unit) => ({ id: unit.id, name: unit.name, code: unit.code }))}
            categories={categories.map((category) => ({
              id: category.id,
              label: `${category.code} — ${category.label}`,
              requiresApproval: category.requiresApproval,
            }))}
            defaultValues={{
              code: null,
              barcode: null,
              name: "",
              description: null,
              categoryId: "",
              unitId: "",
              referencePrice: "0.00",
              controlledByLot: false,
              perishable: false,
              requiresApproval: false,
              hasSerialControl: false,
              active: true,
            }}
          />
        </CardContent>
      </Card>
    </PageBody>
  );
}
