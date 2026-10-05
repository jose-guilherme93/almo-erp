import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Badge de status — **único lugar** que define a cor de cada status
 * (AGENTS.md §7 e FASE 10.7).
 *
 * Evita o clássico "verde aqui, verde diferente ali" e torna a leitura das
 * telas consistente para o almoxarife.
 */

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "muted";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "border-transparent bg-secondary text-secondary-foreground",
  info: "border-transparent bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
  success:
    "border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  warning: "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  danger: "border-transparent bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
  muted: "border-border text-muted-foreground bg-transparent",
};

export type BadgeDescriptor = { label: string; tone: Tone };

/* -------------------------------------------------------------------------- */
/* Status de usuário                                                           */
/* -------------------------------------------------------------------------- */

export const USER_STATUS: Record<string, BadgeDescriptor> = {
  ACTIVE: { label: "Ativo", tone: "success" },
  PENDING: { label: "Aguardando aprovação", tone: "warning" },
  SUSPENDED: { label: "Suspenso", tone: "danger" },
  INACTIVE: { label: "Inativo", tone: "muted" },
};

/* -------------------------------------------------------------------------- */
/* Status de solicitação                                                       */
/* -------------------------------------------------------------------------- */

export const REQUEST_STATUS: Record<string, BadgeDescriptor> = {
  DRAFT: { label: "Rascunho", tone: "muted" },
  SUBMITTED: { label: "Aguardando aprovação", tone: "warning" },
  IN_REVIEW: { label: "Em análise", tone: "info" },
  APPROVED: { label: "Aprovada", tone: "success" },
  PARTIALLY_APPROVED: { label: "Aprovada parcialmente", tone: "warning" },
  REJECTED: { label: "Rejeitada", tone: "danger" },
  IN_PREPARATION: { label: "Em separação", tone: "info" },
  DELIVERED: { label: "Entregue", tone: "success" },
  CANCELLED: { label: "Cancelada", tone: "muted" },
};

export const REQUEST_PRIORITY: Record<string, BadgeDescriptor> = {
  LOW: { label: "Baixa", tone: "muted" },
  NORMAL: { label: "Normal", tone: "neutral" },
  HIGH: { label: "Alta", tone: "warning" },
  URGENT: { label: "Urgente", tone: "danger" },
};

/* -------------------------------------------------------------------------- */
/* Status de transferência                                                     */
/* -------------------------------------------------------------------------- */

export const TRANSFER_STATUS: Record<string, BadgeDescriptor> = {
  DRAFT: { label: "Rascunho", tone: "muted" },
  SENT: { label: "Enviada", tone: "info" },
  IN_TRANSIT: { label: "Em trânsito", tone: "warning" },
  RECEIVED: { label: "Recebida", tone: "success" },
  RETURNED: { label: "Devolvida", tone: "danger" },
  CANCELLED: { label: "Cancelada", tone: "muted" },
};

/* -------------------------------------------------------------------------- */
/* Documentos e inventário                                                     */
/* -------------------------------------------------------------------------- */

export const STOCK_DOCUMENT_STATUS: Record<string, BadgeDescriptor> = {
  DRAFT: { label: "Rascunho", tone: "muted" },
  POSTED: { label: "Lançado", tone: "success" },
  CANCELLED: { label: "Cancelado", tone: "danger" },
};

export const STOCK_DOCUMENT_TYPE: Record<string, BadgeDescriptor> = {
  INBOUND: { label: "Entrada", tone: "success" },
  ISSUE: { label: "Saída", tone: "info" },
  ADJUSTMENT: { label: "Ajuste", tone: "warning" },
  TRANSFER_OUT: { label: "Transferência (saída)", tone: "muted" },
  TRANSFER_IN: { label: "Transferência (entrada)", tone: "muted" },
  RETURN: { label: "Devolução", tone: "info" },
  INVENTORY: { label: "Inventário", tone: "neutral" },
};

/* -------------------------------------------------------------------------- */
/* Chamados de reparo                                                          */
/* -------------------------------------------------------------------------- */

export const MAINTENANCE_STATUS_BADGE: Record<string, BadgeDescriptor> = {
  OPEN: { label: "Aberto", tone: "info" },
  IN_REVIEW: { label: "Em análise", tone: "warning" },
  IN_PROGRESS: { label: "Em andamento", tone: "info" },
  WAITING_PARTS: { label: "Aguardando peça", tone: "warning" },
  DONE: { label: "Concluído", tone: "success" },
  REJECTED: { label: "Recusado", tone: "danger" },
  CANCELLED: { label: "Cancelado", tone: "muted" },
};

export const MAINTENANCE_PRIORITY_BADGE: Record<string, BadgeDescriptor> = {
  LOW: { label: "Baixa", tone: "muted" },
  NORMAL: { label: "Normal", tone: "neutral" },
  HIGH: { label: "Alta", tone: "warning" },
  URGENT: { label: "Urgente", tone: "danger" },
};

export const DELEGATION_STATUS: Record<string, BadgeDescriptor> = {
  PENDING: { label: "Aguardando aceite", tone: "warning" },
  ACCEPTED: { label: "Aceita", tone: "info" },
  IN_PROGRESS: { label: "Em análise", tone: "info" },
  COMPLETED: { label: "Concluída — laudo pronto", tone: "success" },
  RETURNED: { label: "Devolvida", tone: "muted" },
  CANCELLED: { label: "Cancelada", tone: "muted" },
};

export const INVENTORY_STATUS: Record<string, BadgeDescriptor> = {
  OPEN: { label: "Aberto", tone: "info" },
  COUNTING: { label: "Em contagem", tone: "warning" },
  CLOSED: { label: "Fechado", tone: "neutral" },
  ADJUSTED: { label: "Ajustado", tone: "success" },
  CANCELLED: { label: "Cancelado", tone: "muted" },
};

/* -------------------------------------------------------------------------- */
/* Componente                                                                  */
/* -------------------------------------------------------------------------- */

export function StatusBadge({
  descriptor,
  className,
}: {
  descriptor: BadgeDescriptor | undefined;
  className?: string;
}) {
  if (!descriptor) {
    return (
      <Badge variant="outline" className={cn("font-normal", className)}>
        —
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn(TONE_CLASSES[descriptor.tone], "font-normal", className)}
    >
      {descriptor.label}
    </Badge>
  );
}

/** Atalho para os dicionários acima. */
export function statusBadge(
  dictionary: Record<string, BadgeDescriptor>,
  status: string,
  className?: string,
) {
  return <StatusBadge descriptor={dictionary[status]} className={className} />;
}
