import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DeliveryForm } from "@/components/domain/delivery-form";
import { REQUEST_STATUS, statusBadge } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isAppError } from "@/lib/errors";
import { requirePagePermission } from "@/server/auth/guards";
import { getRequestDetail } from "@/server/services/request";

export const metadata: Metadata = {
  title: "Conferir entrega",
};

type EntregaPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EntregaPage({ params }: EntregaPageProps) {
  const { id } = await params;
  const context = await requirePagePermission("solicitacao:entregar");

  let request: Awaited<ReturnType<typeof getRequestDetail>>;

  try {
    request = await getRequestDetail(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const awaiting = ["APPROVED", "PARTIALLY_APPROVED", "IN_PREPARATION"].includes(request.status);

  const deliverableLines = request.lines
    .map((line) => ({
      id: line.id,
      itemName: line.item.name,
      itemCode: line.item.code,
      unitCode: line.item.unit.code,
      approvedQuantity: line.approvedQuantity.toString(),
      reservedQuantity:
        line.reservation?.status === "ACTIVE"
          ? line.reservation.quantity.toString()
          : line.approvedQuantity.toString(),
      storageLocationName: line.reservation?.stockLevel.storageLocation.name ?? null,
    }))
    .filter((line) => Number(line.reservedQuantity) > 0);

  return (
    <PageBody className="max-w-3xl">
      <PageHeader
        title="Conferir entrega"
        description={`${request.number} · ${request.requester.name}`}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/entregas">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {statusBadge(REQUEST_STATUS, request.status, "text-sm")}
        <span className="text-muted-foreground text-sm">{request.branch.name}</span>
      </div>

      {!awaiting ? (
        <Card>
          <CardHeader>
            <CardTitle>Esta solicitação não está aguardando entrega</CardTitle>
            <CardDescription>
              Só é possível entregar solicitações aprovadas. Consulte o histórico para ver o que
              aconteceu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href={`/solicitacoes/${request.id}`}>Ver solicitação</Link>
            </Button>
          </CardContent>
        </Card>
      ) : deliverableLines.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nenhum item reservado para entrega</CardTitle>
            <CardDescription>
              A reserva pode ter sido liberada. Verifique a solicitação antes de prosseguir.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href={`/solicitacoes/${request.id}`}>Ver solicitação</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Materiais para separar</CardTitle>
            <CardDescription>
              Ajuste a quantidade se não for possível entregar tudo. O que sobrar volta ao estoque
              automaticamente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeliveryForm
              requestId={request.id}
              requestNumber={request.number}
              requesterName={request.requester.name}
              lines={deliverableLines}
            />
          </CardContent>
        </Card>
      )}
    </PageBody>
  );
}
