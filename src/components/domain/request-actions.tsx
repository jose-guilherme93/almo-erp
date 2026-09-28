"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ActionResult } from "@/lib/action-result";
import { formatQuantity } from "@/lib/format";
import {
  assumirSolicitacaoAction,
  cancelarSolicitacaoAction,
  decidirSolicitacaoAction,
  iniciarSeparacaoAction,
} from "@/server/actions/solicitacao";

/* -------------------------------------------------------------------------- */
/* Solicitante: cancelar                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Ações de quem pediu.
 *
 * Não há "enviar para aprovação": a solicitação já nasce enviada. Pedir
 * material é um ato, não um rascunho — a confirmação só existiria para dar
 * trabalho a quem pediu.
 */
export function RequesterActions({
  requestId,
  status,
  isOwner,
  canApprove,
}: {
  requestId: string;
  status: string;
  isOwner: boolean;
  canApprove: boolean;
}) {
  const [mode, setMode] = useState<"none" | "cancel">("none");

  const [cancelState, cancelAction, isCancelling] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(cancelarSolicitacaoAction, null);

  useEffect(() => {
    if (!cancelState) return;

    if (cancelState.ok) toast.success(cancelState.message ?? "Solicitação cancelada.");
    else toast.error(cancelState.error);
  }, [cancelState]);

  const error = cancelState && !cancelState.ok ? cancelState.error : null;

  const canCancel =
    (isOwner && ["DRAFT", "SUBMITTED"].includes(status)) ||
    (canApprove && ["APPROVED", "PARTIALLY_APPROVED", "IN_PREPARATION"].includes(status));

  return (
    <div className="space-y-3">
      {error ? <FormError message={error} /> : null}

      <div className="flex flex-wrap gap-2">
        {canCancel && mode === "none" ? (
          <Button type="button" variant="outline" onClick={() => setMode("cancel")}>
            Cancelar solicitação
          </Button>
        ) : null}
      </div>

      {mode === "cancel" ? (
        <form action={cancelAction} className="space-y-3 rounded-md border p-3">
          <input type="hidden" name="requestId" value={requestId} />

          <FormField id="cancel-request-reason" label="Motivo (opcional)">
            <Input id="cancel-request-reason" name="reason" />
          </FormField>

          <div className="flex gap-2">
            <Button type="submit" variant="destructive" size="sm" disabled={isCancelling}>
              {isCancelling ? "Cancelando…" : "Confirmar cancelamento"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("none")}>
              Voltar
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Aprovador: assumir e decidir                                                */
/* -------------------------------------------------------------------------- */

const PRIORITY_OPTIONS = [
  { value: "LOW", label: "Baixa", hint: "sem pressa" },
  { value: "NORMAL", label: "Normal", hint: "prazo habitual" },
  { value: "HIGH", label: "Alta", hint: "atender hoje" },
  { value: "URGENT", label: "Urgente", hint: "parada de operação" },
];

export type DecisionLine = {
  id: string;
  itemName: string;
  itemCode: string;
  unitCode: string;
  requestedQuantity: string;
  availabilityStatus: string;
};

export function ApprovalPanel({
  requestId,
  status,
  lines,
  claimedByName,
  claimedById,
  currentUserId,
  isNetworkScope,
}: {
  requestId: string;
  status: string;
  lines: DecisionLine[];
  claimedByName: string | null;
  claimedById: string | null;
  currentUserId: string;
  isNetworkScope: boolean;
}) {
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, line.requestedQuantity])),
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"none" | "decide" | "reject">("none");
  // A urgência é decisão de quem recebe, não de quem pediu.
  const [priority, setPriority] = useState("NORMAL");

  const [claimState, claimAction, isClaiming] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(assumirSolicitacaoAction, null);

  const [decisionState, decisionAction, isDeciding] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(decidirSolicitacaoAction, null);

  useEffect(() => {
    for (const state of [claimState, decisionState]) {
      if (!state) continue;
      if (state.ok) toast.success(state.message ?? "Solicitação atualizada.");
      else toast.error(state.error);
    }
  }, [claimState, decisionState]);

  // Fecha o formulário de decisão após uma decisão bem-sucedida. Ajustar o
  // estado durante a renderização evita render em cascata.
  const [handledDecision, setHandledDecision] = useState<typeof decisionState>(null);

  if (decisionState !== handledDecision) {
    setHandledDecision(decisionState);
    if (decisionState?.ok) setMode("none");
  }

  if (status !== "SUBMITTED" && status !== "IN_REVIEW") return null;

  const claimedByOther = claimedById !== null && claimedById !== currentUserId && !isNetworkScope;

  const error =
    (claimState && !claimState.ok ? claimState.error : null) ??
    (decisionState && !decisionState.ok ? decisionState.error : null);

  return (
    <div className="space-y-4">
      {error ? <FormError message={error} /> : null}

      {claimedByName ? (
        <p className="text-muted-foreground text-sm">
          Em análise por <span className="text-foreground font-medium">{claimedByName}</span>.
        </p>
      ) : null}

      {claimedByOther ? (
        <p className="text-muted-foreground text-sm">
          Outro aprovador já assumiu este pedido. Se ele não decidir, a solicitação volta para a
          fila.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!claimedById ? (
          <form action={claimAction}>
            <input type="hidden" name="requestId" value={requestId} />
            <Button type="submit" variant="outline" disabled={isClaiming}>
              {isClaiming ? "Assumindo…" : "Assumir análise"}
            </Button>
          </form>
        ) : null}

        {mode === "none" && !claimedByOther ? (
          <>
            <Button type="button" onClick={() => setMode("decide")}>
              Decidir
            </Button>
            <Button type="button" variant="outline" onClick={() => setMode("reject")}>
              Rejeitar
            </Button>
          </>
        ) : null}
      </div>

      {mode === "decide" ? (
        <form action={decisionAction} className="space-y-4 rounded-md border p-3">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="decision" value="approve" />
          <input type="hidden" name="priority" value={priority} />

          <FormField
            id="decision-priority"
            label="Prioridade deste pedido"
            hint="Você define: quem pediu não tem como saber o que é urgente para a operação."
          >
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger id="decision-priority" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label} — {option.hint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <p className="text-sm font-medium">Quantidade aprovada</p>
          <p className="text-muted-foreground text-xs">
            Reduzir a quantidade exige motivo: o solicitante precisa entender o que não foi
            atendido.
          </p>

          <div className="space-y-3">
            {lines.map((line) => {
              const approved = Number(quantities[line.id] ?? "0");
              const requested = Number(line.requestedQuantity);
              const isPartial = Number.isFinite(approved) && approved < requested;

              return (
                <div key={line.id} className="space-y-2 rounded-md border p-3">
                  <input type="hidden" name="lineId" value={line.id} />

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{line.itemName}</p>
                      <p className="text-muted-foreground font-mono text-xs">
                        {line.itemCode} · solicitado {formatQuantity(line.requestedQuantity)}{" "}
                        {line.unitCode}
                      </p>
                    </div>

                    {line.availabilityStatus !== "AVAILABLE" ? (
                      <Badge variant="outline" className="border-amber-300 text-amber-700">
                        {line.availabilityStatus === "PARTIAL"
                          ? "disponível parcialmente"
                          : "sem saldo na unidade"}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label htmlFor={`approved-${line.id}`} className="text-xs">
                        Aprovar ({line.unitCode})
                      </label>
                      <Input
                        id={`approved-${line.id}`}
                        name="lineApprovedQuantity"
                        type="number"
                        step="0.0001"
                        min="0"
                        max={line.requestedQuantity}
                        value={quantities[line.id] ?? "0"}
                        onChange={(event) =>
                          setQuantities((current) => ({
                            ...current,
                            [line.id]: event.target.value,
                          }))
                        }
                      />
                    </div>

                    {isPartial ? (
                      <div className="space-y-1">
                        <label htmlFor={`reason-${line.id}`} className="text-xs">
                          Motivo da quantidade menor
                        </label>
                        <Input
                          id={`reason-${line.id}`}
                          name="lineNonApprovalReason"
                          value={reasons[line.id] ?? ""}
                          onChange={(event) =>
                            setReasons((current) => ({
                              ...current,
                              [line.id]: event.target.value,
                            }))
                          }
                          required
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <FormField id="decision-comment" label="Comentário">
            <Textarea id="decision-comment" name="comment" rows={2} />
          </FormField>

          <div className="flex gap-2">
            <Button type="submit" disabled={isDeciding}>
              {isDeciding ? "Aprovando…" : "Confirmar aprovação"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("none")}>
              Voltar
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "reject" ? (
        <form action={decisionAction} className="space-y-3 rounded-md border p-3">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="decision" value="reject" />

          <FormField id="reject-reason" label="Motivo da rejeição" required>
            <Textarea
              id="reject-reason"
              name="reason"
              rows={3}
              placeholder="Explique para o solicitante o que motivou a rejeição."
              required
            />
          </FormField>

          <div className="flex gap-2">
            <Button type="submit" variant="destructive" disabled={isDeciding}>
              {isDeciding ? "Rejeitando…" : "Confirmar rejeição"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("none")}>
              Voltar
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Almoxarife: iniciar separação                                               */
/* -------------------------------------------------------------------------- */

export function PreparationAction({ requestId, status }: { requestId: string; status: string }) {
  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    iniciarSeparacaoAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message ?? "Separação iniciada.");
    else toast.error(state.error);
  }, [state]);

  if (status !== "APPROVED" && status !== "PARTIALLY_APPROVED") return null;

  return (
    <div className="space-y-3">
      {state && !state.ok ? <FormError message={state.error} /> : null}

      <form action={formAction}>
        <input type="hidden" name="requestId" value={requestId} />
        <Button type="submit" variant="outline" disabled={isPending}>
          {isPending ? "Iniciando…" : "Iniciar separação"}
        </Button>
      </form>
    </div>
  );
}
