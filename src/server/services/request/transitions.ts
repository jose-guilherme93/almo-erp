import type { RequestStatus } from "@/generated/prisma/enums";
import { InvalidTransitionError } from "@/lib/errors";

/**
 * Máquina de estados da solicitação.
 *
 *   DRAFT ──enviar──▶ SUBMITTED ──assumir──▶ IN_REVIEW
 *                        │                      │
 *                        │                      ├──aprovar tudo────▶ APPROVED
 *                        │                      ├──aprovar parcial─▶ PARTIALLY_APPROVED
 *                        │                      └──rejeitar────────▶ REJECTED
 *                        │
 *   APPROVED / PARTIALLY_APPROVED ──separar──▶ IN_PREPARATION ──entregar──▶ DELIVERED
 *   DRAFT / SUBMITTED ──cancelar──▶ CANCELLED
 */

const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  // Decidir direto da fila é o fluxo comum: o aprovador olha a lista e
  // aprova ou rejeita sem precisar "assumir" antes.
  SUBMITTED: ["IN_REVIEW", "APPROVED", "PARTIALLY_APPROVED", "REJECTED", "CANCELLED"],
  IN_REVIEW: ["APPROVED", "PARTIALLY_APPROVED", "REJECTED"],
  APPROVED: ["IN_PREPARATION", "CANCELLED"],
  PARTIALLY_APPROVED: ["IN_PREPARATION", "CANCELLED"],
  REJECTED: [],
  IN_PREPARATION: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RequestStatus, to: RequestStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to, "a solicitação");
  }
}

/** Estados em que a solicitação ainda pode ser editada pelo solicitante. */
export function isEditable(status: RequestStatus): boolean {
  return status === "DRAFT";
}

/** Estados que contam como "aguardando decisão" na fila de aprovação. */
export const PENDING_APPROVAL_STATUSES: readonly RequestStatus[] = ["SUBMITTED", "IN_REVIEW"];

/** Estados em que a solicitação está aprovada e aguardando entrega. */
export const AWAITING_DELIVERY_STATUSES: readonly RequestStatus[] = [
  "APPROVED",
  "PARTIALLY_APPROVED",
  "IN_PREPARATION",
];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  DRAFT: "Rascunho",
  SUBMITTED: "Aguardando aprovação",
  IN_REVIEW: "Em análise",
  APPROVED: "Aprovada",
  PARTIALLY_APPROVED: "Aprovada parcialmente",
  REJECTED: "Rejeitada",
  IN_PREPARATION: "Em separação",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelada",
};
