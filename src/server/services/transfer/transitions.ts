import type { TransferStatus } from "@/generated/prisma/enums";
import { InvalidTransitionError } from "@/lib/errors";

/**
 * Máquina de estados da transferência.
 *
 *   DRAFT ──enviar──▶ SENT ──confirmar despacho──▶ IN_TRANSIT ──receber──▶ RECEIVED
 *     │                  │                            │
 *     └──cancelar────────┴──cancelar──────────────────┴──devolver──▶ RETURNED
 */

const TRANSITIONS: Record<TransferStatus, readonly TransferStatus[]> = {
  DRAFT: ["SENT", "CANCELLED"],
  // O despacho é opcional: dá para receber direto de SENT.
  SENT: ["IN_TRANSIT", "RECEIVED", "CANCELLED"],
  IN_TRANSIT: ["RECEIVED", "RETURNED"],
  RECEIVED: [],
  RETURNED: [],
  CANCELLED: [],
};

export function canTransition(from: TransferStatus, to: TransferStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TransferStatus, to: TransferStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to, "a transferência");
  }
}

/** Transições possíveis a partir do estado atual (para a interface). */
export function availableTransitions(
  from: TransferStatus,
  permissions: { canSend: boolean; canReceive: boolean; canCancel: boolean },
): TransferStatus[] {
  return TRANSITIONS[from].filter((to) => {
    if (to === "CANCELLED") return permissions.canCancel;
    if (to === "RECEIVED" || to === "RETURNED") return permissions.canReceive;
    return permissions.canSend;
  });
}

export const TRANSITION_LABELS: Record<TransferStatus, string> = {
  DRAFT: "Rascunho",
  SENT: "Enviada",
  IN_TRANSIT: "Em trânsito",
  RECEIVED: "Recebida",
  RETURNED: "Devolvida",
  CANCELLED: "Cancelada",
};
