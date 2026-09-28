import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DelegationActions } from "@/components/domain/delegation-actions";
import { DELEGATION_STATUS, statusBadge } from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isAppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { requirePagePermission } from "@/server/auth/guards";
import { getDelegation } from "@/server/services/delegation";

export const metadata: Metadata = {
  title: "Encaminhamento",
};

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Etapa criada",
  ACCEPTED: "Etapa aceita",
  PROGRESS_UPDATED: "Andamento registrado",
  COMPLETED: "Etapa concluída com laudo",
  RETURNED: "Etapa encerrada pelo setor de origem",
  CANCELLED: "Encaminhamento cancelado",
  COMMENTED: "Comentário",
};

export default async function EncaminhamentoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requirePagePermission("manutencao:atender");

  let delegation: Awaited<ReturnType<typeof getDelegation>>;

  try {
    delegation = await getDelegation(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const parent = delegation.request ?? delegation.maintenanceRequest;
  const parentHref = delegation.request
    ? `/solicitacoes/${delegation.request.id}`
    : `/reparos/${delegation.maintenanceRequest?.id ?? ""}`;

  const isTargetSector = context.sectorIds.includes(delegation.toSector.id);
  const isOriginSector = context.sectorIds.includes(delegation.fromSector.id);
  const isOpen = ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(delegation.status);

  return (
    <PageBody className="max-w-3xl">
      <PageHeader
        title={`${delegation.fromSector.name} → ${delegation.toSector.name}`}
        description={`Criada em ${formatDateTime(delegation.createdAt)} por ${delegation.requestedBy.name}`}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/encaminhamentos">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {statusBadge(DELEGATION_STATUS, delegation.status)}
        {parent ? (
          <Button asChild variant="outline" size="sm">
            <Link href={parentHref}>
              Abrir {delegation.request ? "solicitação" : "chamado"}{" "}
              {delegation.request?.number ?? delegation.maintenanceRequest?.number}
            </Link>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>O que foi pedido</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="whitespace-pre-line">{delegation.reason}</p>
        </CardContent>
      </Card>

      {delegation.report ? (
        <Card>
          <CardHeader>
            <CardTitle>Laudo da análise</CardTitle>
            <CardDescription>
              {delegation.completedBy ? `Registrado por ${delegation.completedBy.name}` : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="whitespace-pre-line">{delegation.report}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Ações</CardTitle>
        </CardHeader>
        <CardContent>
          <DelegationActions
            delegationId={delegation.id}
            status={delegation.status}
            isTargetSector={isTargetSector}
            isOriginSector={isOriginSector}
            canCancel={isOriginSector && isOpen}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico da etapa</CardTitle>
        </CardHeader>
        <CardContent>
          {delegation.events.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum registro ainda.</p>
          ) : (
            <ul className="divide-y text-sm">
              {delegation.events.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                >
                  <span>
                    <span className="font-medium">{EVENT_LABELS[event.type] ?? event.type}</span>
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
          )}
        </CardContent>
      </Card>
    </PageBody>
  );
}
