import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";

import { AttachmentGallery } from "@/components/domain/attachment-gallery";
import { EncaminharEtapaForm } from "@/components/domain/delegation-actions";
import { DelegationList } from "@/components/domain/delegation-list";
import {
  ApprovalPanel,
  PreparationAction,
  RequesterActions,
} from "@/components/domain/request-actions";
import { REQUEST_PRIORITY, REQUEST_STATUS, statusBadge } from "@/components/domain/status-badge";
import { SuccessCallout, successMessageFrom } from "@/components/domain/success-callout";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate, formatDateTime, formatQuantity } from "@/lib/format";
import type { RawSearchParams } from "@/lib/pagination";
import { isAppError } from "@/lib/errors";
import { requirePagePermission } from "@/server/auth/guards";
import { listDelegationsForEntity } from "@/server/services/delegation";
import { estimateRequestValue, getRequestDetail } from "@/server/services/request";
import { listActiveSectors } from "@/server/services/sector";

export const metadata: Metadata = {
  title: "Solicitação",
};

type RequestPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
};

export default async function SolicitacaoDetalhePage({ params, searchParams }: RequestPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const context = await requirePagePermission("solicitacao:read");

  let request: Awaited<ReturnType<typeof getRequestDetail>>;

  try {
    request = await getRequestDetail(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const isOwner = request.requester.id === context.user.id;
  const canApprove = context.hasPermission("solicitacao:approve", request.branch.id);
  const canDeliver = context.hasPermission("solicitacao:entregar", request.branch.id);
  const canDelegate = context.hasPermission("manutencao:delegar", request.branch.id);

  const [delegations, sectors] = await Promise.all([
    listDelegationsForEntity(context, "REQUEST", request.id),
    canDelegate ? listActiveSectors() : Promise.resolve([]),
  ]);

  const canDelegateNow =
    canDelegate && !["DELIVERED", "CANCELLED", "REJECTED"].includes(request.status);

  const estimatedValue = estimateRequestValue(
    request.lines.map((line) => ({
      requestedQuantity: line.requestedQuantity,
      unitPriceSnapshot: line.unitPriceSnapshot,
    })),
  );

  const successMessage = successMessageFrom(query, {
    criada: "Solicitação criada como rascunho. Envie quando estiver pronta.",
    entregue: "Entrega registrada e estoque baixado.",
  });

  const awaitingDelivery = ["APPROVED", "PARTIALLY_APPROVED", "IN_PREPARATION"].includes(
    request.status,
  );

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title={request.number}
        description={`${request.branch.name}${
          request.sector ? ` · ${request.sector.name}` : ""
        } · solicitado por ${request.requester.name} em ${formatDateTime(request.createdAt)}`}
        action={
          <div className="flex gap-2">
            {request.delivery ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/entregas/${request.id}/comprovante`}>
                  <Printer className="size-4" />
                  Comprovante
                </Link>
              </Button>
            ) : null}

            <Button asChild variant="ghost" size="sm">
              <Link href={canApprove ? "/solicitacoes/fila" : "/solicitacoes"}>
                <ArrowLeft className="size-4" />
                Voltar
              </Link>
            </Button>
          </div>
        }
      />

      {successMessage ? <SuccessCallout message={successMessage} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {statusBadge(REQUEST_STATUS, request.status, "text-sm")}
        {statusBadge(REQUEST_PRIORITY, request.priority, "text-sm")}
        {request.neededAt ? (
          <span className="text-muted-foreground text-sm">
            precisa para {formatDate(request.neededAt)}
          </span>
        ) : null}
        <span className="text-muted-foreground text-sm">
          valor estimado {formatCurrency(estimatedValue)}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Itens solicitados</CardTitle>
          <CardDescription>
            {request.lines.length} material(is). Quantidade solicitada, aprovada e entregue.
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
                    Solicitado
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Aprovado
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Entregue
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {request.lines.map((line) => (
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
                      {line.nonApprovalReason ? (
                        <span className="mt-0.5 block text-xs text-amber-700">
                          Não aprovado integralmente: {line.nonApprovalReason}
                        </span>
                      ) : null}
                      {line.lineNotes ? (
                        <span className="text-muted-foreground mt-0.5 block text-xs">
                          {line.lineNotes}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatQuantity(line.requestedQuantity)} {line.item.unit.code}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {Number(line.approvedQuantity) > 0 ? (
                        formatQuantity(line.approvedQuantity)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {Number(line.deliveredQuantity) > 0 ? (
                        formatQuantity(line.deliveredQuantity)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {request.notes ? (
            <p className="text-muted-foreground mt-3 text-sm">
              <span className="font-medium">Justificativa:</span> {request.notes}
            </p>
          ) : null}

          {request.rejectionReason ? (
            <p className="mt-2 text-sm text-red-700">
              <span className="font-medium">Motivo:</span> {request.rejectionReason}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {request.attachments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Fotos</CardTitle>
            <CardDescription>Imagens anexadas à solicitação.</CardDescription>
          </CardHeader>
          <CardContent>
            <AttachmentGallery
              items={request.attachments.map((attachment) => ({
                id: attachment.id,
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
                createdAt: attachment.createdAt,
              }))}
            />
          </CardContent>
        </Card>
      ) : null}

      {delegations.length > 0 || canDelegateNow ? (
        <Card>
          <CardHeader>
            <CardTitle>Etapas com outros setores</CardTitle>
            <CardDescription>
              Enquanto uma etapa está aberta, quem responde por ela é o setor de destino.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <DelegationList items={delegations} sectorIds={context.sectorIds} />

            {canDelegateNow ? (
              <EncaminharEtapaForm
                key={`encaminhar-${delegations.length}`}
                entityType="REQUEST"
                entityId={request.id}
                sectors={sectors.map((sector) => ({ id: sector.id, name: sector.name }))}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {request.delivery ? (
        <Card>
          <CardHeader>
            <CardTitle>Entrega</CardTitle>
            <CardDescription>
              Recebido por {request.delivery.receivedByName} em{" "}
              {formatDateTime(request.delivery.deliveredAt)}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Entregue por:</span>{" "}
              {request.delivery.deliveredBy.name}
            </p>
            {request.delivery.receivedByDocument ? (
              <p>
                <span className="text-muted-foreground">Documento:</span>{" "}
                {request.delivery.receivedByDocument}
              </p>
            ) : null}
            {request.delivery.stockDocument ? (
              <p>
                <span className="text-muted-foreground">Movimentação de estoque:</span>{" "}
                <Link
                  href={`/estoque/movimentacoes/${request.delivery.stockDocument.id}`}
                  className="font-mono underline"
                >
                  {request.delivery.stockDocument.number}
                </Link>
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {canApprove || isOwner || (canDeliver && awaitingDelivery) ? (
        <Card>
          <CardHeader>
            <CardTitle>Ações</CardTitle>
            <CardDescription>O que cada perfil pode fazer nesta etapa do pedido.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <RequesterActions
              requestId={request.id}
              status={request.status}
              isOwner={isOwner}
              canApprove={canApprove}
            />

            {canApprove ? (
              <div className="border-t pt-4">
                <ApprovalPanel
                  requestId={request.id}
                  status={request.status}
                  currentUserId={context.user.id}
                  isNetworkScope={context.isNetworkScope}
                  claimedById={request.claimedBy?.id ?? null}
                  claimedByName={request.claimedBy?.name ?? null}
                  lines={request.lines.map((line) => ({
                    id: line.id,
                    itemName: line.item.name,
                    itemCode: line.item.code,
                    unitCode: line.item.unit.code,
                    requestedQuantity: line.requestedQuantity.toString(),
                    availabilityStatus: line.availabilityStatus,
                  }))}
                />
              </div>
            ) : null}

            {canDeliver && awaitingDelivery ? (
              <div className="border-t pt-4">
                <PreparationAction requestId={request.id} status={request.status} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
          <CardDescription>Quem fez o quê, e quando.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {request.events.map((event) => (
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
    SUBMITTED: "Enviada para aprovação",
    CLAIMED: "Assumida para análise",
    APPROVED: "Aprovada",
    PARTIALLY_APPROVED: "Aprovada parcialmente",
    REJECTED: "Rejeitada",
    PREPARATION_STARTED: "Separação iniciada",
    DELIVERED: "Entregue",
    CANCELLED: "Cancelada",
    COMMENTED: "Comentário",
  };

  return labels[type] ?? type;
}
