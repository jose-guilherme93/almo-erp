import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ItemForm } from "@/components/domain/item-form";
import { LotManager, StockPolicyManager } from "@/components/domain/item-detail-panels";
import { SuccessCallout, successMessageFrom } from "@/components/domain/success-callout";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDateTime, formatQuantity } from "@/lib/format";
import { firstParam, type RawSearchParams } from "@/lib/pagination";
import { isAppError } from "@/lib/errors";
import { requirePagePermission } from "@/server/auth/guards";
import { listBranchOptions } from "@/server/services/branch";
import { listCategoryOptions } from "@/server/services/catalog/category";
import { getItemDetail } from "@/server/services/catalog/item";
import { listUnits } from "@/server/services/catalog/unit";

export const metadata: Metadata = {
  title: "Material",
};

const TABS = [
  { id: "dados", label: "Dados" },
  { id: "lotes", label: "Lotes" },
  { id: "minimos", label: "Mínimos por unidade" },
  { id: "estoque", label: "Estoque" },
] as const;

type ItemPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
};

export default async function ItemDetalhePage({ params, searchParams }: ItemPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const context = await requirePagePermission("item:read");

  let item: Awaited<ReturnType<typeof getItemDetail>>;

  try {
    item = await getItemDetail(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const requestedTab = firstParam(query, "aba") ?? "dados";
  const tab = TABS.some((entry) => entry.id === requestedTab)
    ? (requestedTab as (typeof TABS)[number]["id"])
    : "dados";

  const canManage = context.hasPermission("item:manage");

  const [units, categories, branches] = await Promise.all([
    tab === "dados" ? listUnits({ onlyActive: true }) : Promise.resolve([]),
    tab === "dados" ? listCategoryOptions() : Promise.resolve([]),
    tab === "minimos" ? listBranchOptions(context) : Promise.resolve([]),
  ]);

  const successMessage = successMessageFrom(query, {
    criado: "Material cadastrado.",
    salvo: "Dados do material atualizados.",
  });

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title={item.name}
        description={`${item.code} · ${item.category.name} · ${item.unit.code}`}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/catalogo/itens">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      {successMessage ? <SuccessCallout message={successMessage} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {!item.active ? <Badge variant="outline">inativo</Badge> : null}
        {item.controlledByLot ? <Badge variant="outline">controlado por lote</Badge> : null}
        {item.perishable ? <Badge variant="outline">perecível</Badge> : null}
        {item.requiresApproval ? <Badge variant="outline">exige aprovação</Badge> : null}
        {item.hasSerialControl ? <Badge variant="outline">número de série</Badge> : null}
        <span className="text-muted-foreground text-sm">
          Preço de referência {formatCurrency(item.referencePrice)}
        </span>
      </div>

      <nav className="flex flex-wrap gap-1 border-b" aria-label="Seções do material">
        {TABS.map((entry) => (
          <Link
            key={entry.id}
            href={`/catalogo/itens/${item.id}?aba=${entry.id}`}
            aria-current={tab === entry.id ? "page" : undefined}
            className={
              tab === entry.id
                ? "border-primary text-foreground -mb-px border-b-2 px-3 py-2 text-sm font-medium"
                : "text-muted-foreground hover:text-foreground px-3 py-2 text-sm"
            }
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {tab === "dados" ? (
        <Card>
          <CardHeader>
            <CardTitle>Cadastro</CardTitle>
            <CardDescription>Criado em {formatDateTime(item.createdAt)}.</CardDescription>
          </CardHeader>
          <CardContent>
            {canManage ? (
              <ItemForm
                mode="edit"
                units={units.map((unit) => ({ id: unit.id, name: unit.name, code: unit.code }))}
                categories={categories.map((category) => ({
                  id: category.id,
                  label: `${category.code} — ${category.label}`,
                  requiresApproval: category.requiresApproval,
                }))}
                defaultValues={{
                  id: item.id,
                  code: item.code,
                  barcode: item.barcode,
                  name: item.name,
                  description: item.description,
                  categoryId: item.category.id,
                  unitId: item.unit.id,
                  referencePrice: item.referencePrice.toString(),
                  controlledByLot: item.controlledByLot,
                  perishable: item.perishable,
                  requiresApproval: item.requiresApproval,
                  hasSerialControl: item.hasSerialControl,
                  active: item.active,
                }}
              />
            ) : (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground text-xs">Descrição</dt>
                  <dd>{item.description ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Código de barras</dt>
                  <dd className="font-mono">{item.barcode ?? "—"}</dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "lotes" ? (
        <Card>
          <CardHeader>
            <CardTitle>Lotes</CardTitle>
            <CardDescription>
              Lotes vencidos não podem ser usados em saída de estoque.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LotManager
              itemId={item.id}
              controlledByLot={item.controlledByLot}
              canManage={canManage}
              lots={item.lots.map((lot) => ({
                id: lot.id,
                code: lot.code,
                expirationDate: lot.expirationDate,
                active: lot.active,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      {tab === "minimos" ? (
        <Card>
          <CardHeader>
            <CardTitle>Mínimos por unidade</CardTitle>
            <CardDescription>
              Quando o saldo disponível cruza o mínimo, o almoxarife da unidade é avisado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StockPolicyManager
              itemId={item.id}
              unitCode={item.unit.code}
              canManage={canManage}
              policies={item.stockPolicies.map((policy) => ({
                id: policy.id,
                branchName: policy.branch.name,
                branchCode: policy.branch.code,
                minimumQuantity: policy.minimumQuantity.toString(),
                maximumQuantity: policy.maximumQuantity?.toString() ?? null,
              }))}
              branches={branches.map((branch) => ({
                id: branch.id,
                code: branch.code,
                name: branch.name,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      {tab === "estoque" ? (
        <Card>
          <CardHeader>
            <CardTitle>Saldo por unidade</CardTitle>
            <CardDescription>
              {item.stockLevels.length === 0
                ? "Este material ainda não tem estoque lançado."
                : `${item.stockLevels.length} local(is) com registro.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {item.stockLevels.length === 0 ? null : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        Unidade
                      </th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        Local
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Saldo
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Reservado
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Disponível
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">
                        Custo médio
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {item.stockLevels.map((level) => (
                      <tr key={level.id}>
                        <td className="px-3 py-2">
                          {level.branch.code}
                          <span className="text-muted-foreground ml-1 text-xs">
                            {level.branch.name}
                          </span>
                        </td>
                        <td className="px-3 py-2">{level.storageLocation.name}</td>
                        <td className="px-3 py-2 text-right">{formatQuantity(level.quantity)}</td>
                        <td className="px-3 py-2 text-right">
                          {formatQuantity(level.reservedQuantity)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          {formatQuantity(level.quantity.minus(level.reservedQuantity))}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatCurrency(level.averageCost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-muted-foreground mt-3 text-xs">
              O lançamento de estoque é feito em{" "}
              <span className="font-medium">Estoque → Entradas</span>.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </PageBody>
  );
}
