import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";

import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { APP_NAME } from "@/lib/constants";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { prisma } from "@/lib/db";
import { requirePagePermission } from "@/server/auth/guards";
import { getRequestDetail } from "@/server/services/request";

export const metadata: Metadata = {
  title: "Comprovante de entrega",
};

type ComprovantePageProps = {
  params: Promise<{ id: string }>;
};

/**
 * Comprovante de entrega.
 *
 * Feito para impressão: fundo branco, sem menu, e espaço para assinatura de
 * quem retirou o material. É o papel que resolve a discussão depois.
 */
export default async function ComprovantePage({ params }: ComprovantePageProps) {
  const { id } = await params;
  const context = await requirePagePermission("solicitacao:read");

  const request = await getRequestDetail(context, id);

  if (!request.delivery) notFound();

  const branch = await prisma.branch.findUnique({
    where: { id: request.branch.id },
    select: { cnpj: true, street: true, number: true, district: true, city: true, state: true },
  });

  const deliveredLines = request.lines.filter((line) => Number(line.deliveredQuantity) > 0);

  return (
    <PageBody className="max-w-3xl">
      {/* Some na impressão: o papel não precisa do botão. */}
      <div className="print:hidden">
        <PageHeader
          title="Comprovante de entrega"
          description="Pronto para impressão. Use Ctrl+P ou o botão abaixo."
          action={
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/solicitacoes/${request.id}`}>
                  <ArrowLeft className="size-4" />
                  Voltar
                </Link>
              </Button>
              <Button asChild size="sm">
                <Link href={`/entregas/${request.id}/comprovante`} target="_blank">
                  <Printer className="size-4" />
                  Abrir para imprimir
                </Link>
              </Button>
            </div>
          }
        />
      </div>

      <Card className="print:border-0 print:shadow-none">
        <CardContent className="space-y-6 pt-6">
          <header className="space-y-1 border-b pb-4">
            <h1 className="text-xl font-semibold">{APP_NAME} — Comprovante de entrega</h1>
            <p className="text-muted-foreground text-sm">
              {request.branch.name}
              {branch?.cnpj ? ` · CNPJ ${branch.cnpj}` : ""}
            </p>
            {branch?.street ? (
              <p className="text-muted-foreground text-sm">
                {branch.street}, {branch.number ?? "s/n"} — {branch.district ?? ""},{" "}
                {branch.city ?? ""}/{branch.state ?? ""}
              </p>
            ) : null}
          </header>

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs">Solicitação</dt>
              <dd className="font-mono">{request.number}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Data da entrega</dt>
              <dd>{formatDateTime(request.delivery.deliveredAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Solicitante</dt>
              <dd>{request.requester.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Entregue por</dt>
              <dd>{request.delivery.deliveredBy.name}</dd>
            </div>
            {request.delivery.stockDocument ? (
              <div>
                <dt className="text-muted-foreground text-xs">Movimentação de estoque</dt>
                <dd className="font-mono">{request.delivery.stockDocument.number}</dd>
              </div>
            ) : null}
          </dl>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-y">
                <th scope="col" className="py-2 text-left font-medium">
                  Material
                </th>
                <th scope="col" className="py-2 text-left font-medium">
                  Código
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Quantidade
                </th>
              </tr>
            </thead>
            <tbody>
              {deliveredLines.map((line) => (
                <tr key={line.id} className="border-b">
                  <td className="py-2">{line.item.name}</td>
                  <td className="py-2 font-mono text-xs">{line.item.code}</td>
                  <td className="py-2 text-right">
                    {formatQuantity(line.deliveredQuantity)} {line.item.unit.code}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {request.delivery.notes ? (
            <p className="text-sm">
              <span className="font-medium">Observação:</span> {request.delivery.notes}
            </p>
          ) : null}

          <div className="grid gap-8 pt-12 sm:grid-cols-2">
            <div className="space-y-1 border-t pt-2">
              <p className="text-sm font-medium">{request.delivery.receivedByName}</p>
              <p className="text-muted-foreground text-xs">
                Recebido por
                {request.delivery.receivedByDocument
                  ? ` · documento ${request.delivery.receivedByDocument}`
                  : ""}
              </p>
            </div>

            <div className="space-y-1 border-t pt-2">
              <p className="text-sm font-medium">{request.delivery.deliveredBy.name}</p>
              <p className="text-muted-foreground text-xs">Entregue por</p>
            </div>
          </div>

          <p className="text-muted-foreground pt-4 text-center text-xs">
            Documento gerado eletronicamente em {formatDateTime(new Date())}.
          </p>
        </CardContent>
      </Card>
    </PageBody>
  );
}
