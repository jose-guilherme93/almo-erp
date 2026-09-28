import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TriangleAlert } from "lucide-react";

import { CancelInventoryForm, InventoryCountForm } from "@/components/domain/inventory-count-form";
import { InventoryAdjustmentForm } from "@/components/domain/inventory-adjust-form";
import { SuccessCallout, successMessageFrom } from "@/components/domain/success-callout";
import { INVENTORY_STATUS, statusBadge } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatQuantity } from "@/lib/format";
import type { RawSearchParams } from "@/lib/pagination";
import { isAppError } from "@/lib/errors";
import { requirePagePermission } from "@/server/auth/guards";
import { getInventorySession, inventoryProgress } from "@/server/services/inventory";

export const metadata: Metadata = {
  title: "Inventário",
};

type InventoryPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
};

export default async function InventarioDetalhePage({ params, searchParams }: InventoryPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const context = await requirePagePermission("inventario:read");

  let session: Awaited<ReturnType<typeof getInventorySession>>;

  try {
    session = await getInventorySession(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const progress = await inventoryProgress(session.id);
  const canManage = context.hasPermission("inventario:manage", session.branch.id);

  const divergentLines = session.lines.filter(
    (line) =>
      line.countedQuantity !== null && line.difference !== null && !line.difference.isZero(),
  );

  const successMessage = successMessageFrom(query, {
    criado: "Inventário aberto. Comece a contagem.",
    ajustado: "Ajuste aplicado no estoque.",
  });

  const isCounting = session.status === "COUNTING" || session.status === "OPEN";
  const needsAdjustment = session.status === "CLOSED" && divergentLines.length > 0;

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title={session.number}
        description={`${session.branch.name} · aberto por ${session.createdBy.name} em ${formatDateTime(
          session.createdAt,
        )}`}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/inventario">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      {successMessage ? <SuccessCallout message={successMessage} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {statusBadge(INVENTORY_STATUS, session.status, "text-sm")}
        <span className="text-muted-foreground text-sm">
          {progress.counted} de {progress.total} contados
        </span>
        {progress.divergent > 0 ? (
          <Badge variant="outline" className="border-amber-300 text-amber-700">
            {progress.divergent} divergência(s)
          </Badge>
        ) : null}
        {session.closedBy ? (
          <span className="text-muted-foreground text-sm">
            encerrado por {session.closedBy.name} em{" "}
            {session.closedAt ? formatDateTime(session.closedAt) : "—"}
          </span>
        ) : null}
      </div>

      {needsAdjustment ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            A contagem foi encerrada com divergências. Revise os itens abaixo e aplique o ajuste
            para o estoque refletir a realidade.
          </span>
        </div>
      ) : null}

      {isCounting && canManage ? (
        <InventoryCountForm
          sessionId={session.id}
          lines={session.lines.map((line) => ({
            id: line.id,
            itemCode: line.item.code,
            itemName: line.item.name,
            unitCode: line.item.unit.code,
            barcode: line.item.barcode,
            locationName: line.storageLocation.name,
            systemQuantity: line.systemQuantity.toString(),
            countedQuantity: line.countedQuantity?.toString() ?? null,
          }))}
        />
      ) : null}

      {needsAdjustment && canManage ? (
        <InventoryAdjustmentForm
          sessionId={session.id}
          lines={divergentLines.map((line) => ({
            id: line.id,
            itemCode: line.item.code,
            itemName: line.item.name,
            unitCode: line.item.unit.code,
            locationName: line.storageLocation.name,
            systemQuantity: line.systemQuantity.toString(),
            countedQuantity: line.countedQuantity?.toString() ?? "0",
          }))}
        />
      ) : null}

      {session.status === "CLOSED" && divergentLines.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Contagem sem divergência</CardTitle>
            <CardDescription>
              O estoque físico bate com o sistema. Nenhum ajuste é necessário.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {session.status === "ADJUSTED" ? (
        <Card>
          <CardHeader>
            <CardTitle>Ajuste aplicado</CardTitle>
            <CardDescription>
              {divergentLines.length} item(ns) ajustado(s). Veja as movimentações geradas em{" "}
              <Link href="/estoque/movimentacoes?tipo=INVENTORY" className="underline">
                Estoque → Movimentações
              </Link>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {!isCounting || !canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Itens da contagem</CardTitle>
            <CardDescription>Posição de cada material no escopo do inventário.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Material
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      Local
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Sistema
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Contado
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Diferença
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {session.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-3 py-2">
                        {line.item.name}
                        <span className="text-muted-foreground ml-2 font-mono text-xs">
                          {line.item.code}
                        </span>
                      </td>
                      <td className="px-3 py-2">{line.storageLocation.name}</td>
                      <td className="px-3 py-2 text-right">
                        {formatQuantity(line.systemQuantity)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {line.countedQuantity === null ? (
                          <span className="text-muted-foreground text-xs">não contado</span>
                        ) : (
                          formatQuantity(line.countedQuantity)
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {line.difference === null || line.difference.isZero() ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={
                              line.difference.isNegative()
                                ? "font-medium text-red-700"
                                : "font-medium text-emerald-700"
                            }
                          >
                            {line.difference.isPositive() ? "+" : ""}
                            {formatQuantity(line.difference)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {canManage && session.status !== "ADJUSTED" && session.status !== "CANCELLED" ? (
        <Card>
          <CardHeader>
            <CardTitle>Cancelar inventário</CardTitle>
          </CardHeader>
          <CardContent>
            <CancelInventoryForm sessionId={session.id} />
          </CardContent>
        </Card>
      ) : null}
    </PageBody>
  );
}
