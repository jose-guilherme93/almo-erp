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
  title: "Nova entrada",
};

export default async function NovaEntradaPage() {
  const context = await requirePagePermission("estoque:entrada");
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
        title="Nova entrada"
        description="Registre o material recebido. O custo informado alimenta o custo médio."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/estoque/entradas">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      {locations.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nenhum local de estoque cadastrado</CardTitle>
            <CardDescription>
              Antes de lançar estoque, cadastre pelo menos um local na unidade.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href={`/filiais/${branchId}?aba=locais`}>Cadastrar local de estoque</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Dados do recebimento</CardTitle>
            <CardDescription>
              Informe o local, os materiais e o custo unitário. Materiais controlados por lote
              exigem a escolha do lote.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StockDocumentForm
              mode="inbound"
              locations={locations}
              branchCode={branch?.branchCode ?? ""}
              defaultLocationId={locations[0]?.id ?? null}
              lots={lots}
            />
          </CardContent>
        </Card>
      )}
    </PageBody>
  );
}
