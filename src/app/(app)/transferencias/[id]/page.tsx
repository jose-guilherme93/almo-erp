import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { SuccessCallout, successMessageFrom } from "@/components/domain/success-callout";
import { ReceiveTransferActions, SendTransferActions } from "@/components/domain/transfer-actions";
import { statusBadge, TRANSFER_STATUS } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatQuantity } from "@/lib/format";
import type { RawSearchParams } from "@/lib/pagination";
import { isAppError } from "@/lib/errors";
import { requirePagePermission } from "@/server/auth/guards";
import { getTransfer } from "@/server/services/transfer";

export const metadata: Metadata = {
  title: "Transferência",
};

type TransferenciaPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
};

export default async function TransferenciaDetalhePage({
  params,
  searchParams,
}: TransferenciaPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const context = await requirePagePermission("transferencia:read");

  let transfer: Awaited<ReturnType<typeof getTransfer>>;

  try {
    transfer = await getTransfer(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const isOrigin = context.branchIds.includes(transfer.originBranch.id);
  const isDestination = context.branchIds.includes(transfer.destinationBranch.id);

  const canSend =
    isOrigin && context.hasPermission("transferencia:enviar", transfer.originBranch.id);
  const canReceive =
    isDestination && context.hasPermission("transferencia:receber", transfer.destinationBranch.id);
  const canCancel =
    isOrigin && context.hasPermission("transferencia:create", transfer.originBranch.id);

  const successMessage = successMessageFrom(query, {
    criada: "Transferência criada como rascunho. Envie quando estiver pronta.",
  });

  const totalSent = transfer.lines.reduce((total, line) => total + Number(line.quantitySent), 0);
  const totalReceived = transfer.lines.reduce(
    (total, line) => total + Number(line.quantityReceived),
    0,
  );

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title={transfer.number}
        description={`Criada por ${transfer.createdBy.name} em ${formatDateTime(transfer.createdAt)}`}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/transferencias">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      {successMessage ? <SuccessCallout message={successMessage} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {statusBadge(TRANSFER_STATUS, transfer.status, "text-sm")}
        <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
          {transfer.originBranch.name}
          <ArrowRight className="size-4" aria-hidden />
          {transfer.destinationBranch.name}
        </span>
      </div>

      {transfer.status === "RECEIVED" ? (
        <SuccessCallout
          message={`Recebida em ${formatDateTime(transfer.receivedAt ?? transfer.createdAt)} por ${
            transfer.receivedBy?.name ?? "—"
          }.`}
        />
      ) : null}

      {transfer.rejectionReason ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm">
              <span className="font-medium">Motivo registrado:</span> {transfer.rejectionReason}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Materiais</CardTitle>
          <CardDescription>
            Enviado {formatQuantity(totalSent)}
            {totalReceived > 0 ? ` · recebido ${formatQuantity(totalReceived)}` : ""}
            {totalSent > totalReceived && transfer.status !== "CANCELLED"
              ? ` · pendente ${formatQuantity(totalSent - totalReceived)}`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">
                    Material
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Enviado
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Recebido
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Pendente
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {transfer.lines.map((line) => {
                  const pending = Number(line.quantitySent) - Number(line.quantityReceived);

                  return (
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
                      <td className="px-3 py-2 text-right">
                        {formatQuantity(line.quantitySent)} {line.item.unit.code}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatQuantity(line.quantityReceived)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {pending > 0 ? (
                          <span className="font-medium text-amber-700">
                            {formatQuantity(pending)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {transfer.notes ? (
            <p className="text-muted-foreground mt-3 text-sm">
              <span className="font-medium">Observação:</span> {transfer.notes}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {transfer.status === "DRAFT" ||
      transfer.status === "SENT" ||
      transfer.status === "IN_TRANSIT" ? (
        <Card>
          <CardHeader>
            <CardTitle>Ações</CardTitle>
            <CardDescription>
              {transfer.status === "DRAFT"
                ? "Enviar baixa o saldo da origem e coloca o material em trânsito."
                : transfer.status === "SENT"
                  ? "Confirme o despacho quando o material sair fisicamente da unidade."
                  : "Confira o material recebido e confirme."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <SendTransferActions
              transferId={transfer.id}
              status={transfer.status}
              canSend={canSend}
              canCancel={canCancel}
            />

            {transfer.status === "SENT" || transfer.status === "IN_TRANSIT" ? (
              <div className="border-t pt-4">
                <ReceiveTransferActions
                  transferId={transfer.id}
                  canReceive={canReceive}
                  lines={transfer.lines.map((line) => ({
                    id: line.id,
                    itemName: line.item.name,
                    itemCode: line.item.code,
                    unitCode: line.item.unit.code,
                    quantitySent: line.quantitySent.toString(),
                    quantityReceived: line.quantityReceived.toString(),
                  }))}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {transfer.events.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-baseline justify-between gap-2 py-2"
              >
                <span>
                  <span className="font-medium">{eventLabel(event.type)}</span>
                  {event.actor ? (
                    <span className="text-muted-foreground"> por {event.actor.name}</span>
                  ) : null}
                  {event.comment ? (
                    <span className="text-muted-foreground"> — {event.comment}</span>
                  ) : null}
                </span>
                <span className="text-muted-foreground text-xs">
                  {formatDateTime(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </PageBody>
  );
}

function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    CREATED: "Criada",
    SENT: "Enviada",
    RECEIVED: "Recebida",
    PARTIALLY_RECEIVED: "Recebida parcialmente",
    RETURNED: "Devolvida",
    CANCELLED: "Cancelada",
  };

  return labels[type] ?? type;
}
