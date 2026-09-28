import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CancelDocumentForm } from "@/components/domain/cancel-document-form";
import { SuccessCallout, successMessageFrom } from "@/components/domain/success-callout";
import {
  statusBadge,
  STOCK_DOCUMENT_STATUS,
  STOCK_DOCUMENT_TYPE,
} from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate, formatDateTime, formatQuantity } from "@/lib/format";
import type { RawSearchParams } from "@/lib/pagination";
import { requirePagePermission } from "@/server/auth/guards";
import { getStockDocument } from "@/server/services/stock/documents";

export const metadata: Metadata = {
  title: "Movimentação",
};

type DocumentPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
};

export default async function MovimentacaoDetalhePage({ params, searchParams }: DocumentPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const context = await requirePagePermission("estoque:read");

  const document = await getStockDocument(context, id);

  if (!document) notFound();

  const canCancel =
    document.status === "POSTED" &&
    (context.hasPermission("estoque:ajuste", document.branch.id) ||
      context.hasPermission("estoque:entrada", document.branch.id));

  const successMessage = successMessageFrom(query, {
    criado: "Movimentação lançada com sucesso.",
  });

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title={document.number}
        description={`${document.branch.code} · ${document.storageLocation.name}`}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/estoque/movimentacoes">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      {successMessage ? <SuccessCallout message={successMessage} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {statusBadge(STOCK_DOCUMENT_TYPE, document.type, "text-sm")}
        {statusBadge(STOCK_DOCUMENT_STATUS, document.status, "text-sm")}
        <span className="text-muted-foreground text-sm">{formatDateTime(document.date)}</span>
        <span className="text-muted-foreground text-sm">Lançado por {document.createdBy.name}</span>
      </div>

      {document.reversalOf.length > 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm">
              Este documento é o <strong>estorno</strong> de{" "}
              <Link
                href={`/estoque/movimentacoes/${document.reversalOf[0]?.id}`}
                className="font-mono underline"
              >
                {document.reversalOf[0]?.number}
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : null}

      {document.reversalDocument ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm">
              Esta movimentação foi cancelada. O estorno é o documento{" "}
              <Link
                href={`/estoque/movimentacoes/${document.reversalDocument.id}`}
                className="font-mono underline"
              >
                {document.reversalDocument.number}
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Itens da movimentação</CardTitle>
          <CardDescription>Quantidade positiva é entrada; negativa é saída.</CardDescription>
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
                    Lote
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Quantidade
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Custo unitário
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {document.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-3 py-2">
                      <Link
                        href={`/catalogo/itens/${line.item.id}?aba=estoque`}
                        className="hover:underline"
                      >
                        {line.item.name}
                      </Link>
                      <span className="text-muted-foreground ml-2 font-mono text-xs">
                        {line.item.code}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {line.itemLot ? (
                        <span>
                          {line.itemLot.code}
                          {line.itemLot.expirationDate ? (
                            <span className="text-muted-foreground block text-xs">
                              vence {formatDate(line.itemLot.expirationDate)}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {formatQuantity(line.quantity)} {line.item.unit.code}
                    </td>
                    <td className="px-3 py-2 text-right">{formatCurrency(line.unitCost)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(line.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/30">
                <tr>
                  <td className="px-3 py-2 text-sm font-medium" colSpan={2}>
                    Total
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatQuantity(document.totalQuantity)}
                  </td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right font-medium">
                    {formatCurrency(document.totalCost)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {document.notes ? (
            <p className="text-muted-foreground mt-3 text-sm">
              <span className="font-medium">Observação:</span> {document.notes}
            </p>
          ) : null}

          {document.referenceId ? (
            <p className="text-muted-foreground mt-1 text-sm">
              <span className="font-medium">Documento de referência:</span> {document.referenceId}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {canCancel ? (
        <Card>
          <CardHeader>
            <CardTitle>Cancelar movimentação</CardTitle>
            <CardDescription>
              O saldo é estornado com um documento inverso. O lançamento original nunca é apagado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CancelDocumentForm documentId={document.id} />
          </CardContent>
        </Card>
      ) : null}
    </PageBody>
  );
}
