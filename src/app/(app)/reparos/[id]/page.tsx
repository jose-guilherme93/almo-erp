import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Tag } from "lucide-react";

import { MaintenanceActions } from "@/components/domain/maintenance-actions";
import { SuccessCallout, successMessageFrom } from "@/components/domain/success-callout";
import {
  MAINTENANCE_PRIORITY_BADGE,
  MAINTENANCE_STATUS_BADGE,
  statusBadge,
} from "@/components/domain/status-badge";
import { PageBody, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatDuration } from "@/lib/format";
import type { RawSearchParams } from "@/lib/pagination";
import { isAppError } from "@/lib/errors";
import { requirePagePermission } from "@/server/auth/guards";
import {
  MAINTENANCE_CATEGORY_LABELS,
  getMaintenanceRequest,
  listMaintenanceAssignees,
} from "@/server/services/maintenance";

export const metadata: Metadata = {
  title: "Chamado de reparo",
};

type ReparoPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
};

export default async function ReparoDetalhePage({ params, searchParams }: ReparoPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const context = await requirePagePermission("manutencao:read");

  let request: Awaited<ReturnType<typeof getMaintenanceRequest>>;

  try {
    request = await getMaintenanceRequest(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const canAttend = context.hasPermission("manutencao:atender", request.branch.id);
  const isOwner = request.requester.id === context.user.id;

  const assignees = canAttend ? await listMaintenanceAssignees(context, request.branch.id) : [];

  const successMessage = successMessageFrom(query, {
    criado: "Chamado aberto. A manutenção da unidade foi avisada.",
  });

  const eventLabels: Record<string, string> = {
    CREATED: "Chamado aberto",
    CLAIMED: "Assumido pela manutenção",
    PRIORITY_SET: "Prioridade definida",
    ASSIGNED: "Atribuído para atendimento",
    PROGRESS_UPDATED: "Andamento registrado",
    WAITING_PARTS: "Aguardando peça",
    COMPLETED: "Concluído",
    REJECTED: "Recusado",
    CANCELLED: "Cancelado",
    COMMENTED: "Comentário",
  };

  return (
    <PageBody className="max-w-3xl">
      <PageHeader
        title={request.title}
        description={`${request.number} · aberto por ${request.requester.name} em ${formatDateTime(
          request.createdAt,
        )}`}
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/reparos">
              <ArrowLeft className="size-4" />
              Voltar
            </Link>
          </Button>
        }
      />

      {successMessage ? <SuccessCallout message={successMessage} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {statusBadge(MAINTENANCE_STATUS_BADGE, request.status, "text-sm")}
        {request.priority ? (
          statusBadge(MAINTENANCE_PRIORITY_BADGE, request.priority, "text-sm")
        ) : (
          <Badge variant="outline" className="border-amber-300 text-amber-700">
            prioridade a definir
          </Badge>
        )}
        <Badge variant="outline">
          {MAINTENANCE_CATEGORY_LABELS[request.category] ?? request.category}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>O problema</CardTitle>
          <CardDescription>Como foi relatado por quem abriu o chamado.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="whitespace-pre-line">{request.description}</p>

          <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
            <span className="flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden />
              {request.location}
            </span>
            {request.assetTag ? (
              <span className="flex items-center gap-1">
                <Tag className="size-3.5" aria-hidden />
                {request.assetTag}
              </span>
            ) : null}
            <span>Unidade: {request.branch.name}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Atendimento</CardTitle>
          <CardDescription>
            {request.assignedTo
              ? `Atribuído a ${request.assignedTo.name}.`
              : canAttend
                ? "Assuma o chamado para começar o atendimento."
                : "A equipe de manutenção da unidade vai assumir este chamado."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs">Solicitante</dt>
              <dd>{request.requester.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Responsável pela unidade</dt>
              <dd>{request.responsible?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Atribuído a</dt>
              <dd>{request.assignedTo?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Tempo até concluir</dt>
              <dd>
                {request.resolutionHours === null ? "—" : formatDuration(request.resolutionHours)}
              </dd>
            </div>
          </dl>

          {request.resolution ? (
            <div className="rounded-md border p-3 text-sm">
              <p className="font-medium">O que foi feito</p>
              <p className="text-muted-foreground mt-1 whitespace-pre-line">{request.resolution}</p>
            </div>
          ) : null}

          {request.rejectReason ? (
            <p className="text-sm text-red-700">
              <span className="font-medium">Motivo:</span> {request.rejectReason}
            </p>
          ) : null}

          <div className="border-t pt-4">
            <MaintenanceActions
              requestId={request.id}
              status={request.status}
              priority={request.priority}
              assignees={assignees}
              canAttend={canAttend}
              isOwner={isOwner}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico</CardTitle>
          <CardDescription>Quem fez o quê, e quando.</CardDescription>
        </CardHeader>
        <CardContent>
          {request.events.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum registro ainda.</p>
          ) : (
            <ul className="divide-y text-sm">
              {request.events.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                >
                  <span>
                    <span className="font-medium">{eventLabels[event.type] ?? event.type}</span>
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
