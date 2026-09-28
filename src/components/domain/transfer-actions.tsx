"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { formatQuantity } from "@/lib/format";
import {
  cancelarTransferenciaAction,
  despacharTransferenciaAction,
  devolverTransferenciaAction,
  enviarTransferenciaAction,
  receberTransferenciaAction,
} from "@/server/actions/transferencia";

/* -------------------------------------------------------------------------- */
/* Enviar / despachar / cancelar (origem)                                      */
/* -------------------------------------------------------------------------- */

export function SendTransferActions({
  transferId,
  status,
  canSend,
  canCancel,
}: {
  transferId: string;
  status: string;
  canSend: boolean;
  canCancel: boolean;
}) {
  const [mode, setMode] = useState<"none" | "cancel">("none");

  const [sendState, sendAction, isSending] = useActionState<ActionResult<unknown> | null, FormData>(
    enviarTransferenciaAction,
    null,
  );

  const [dispatchState, dispatchAction, isDispatching] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(despacharTransferenciaAction, null);

  const [cancelState, cancelAction, isCancelling] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(cancelarTransferenciaAction, null);

  useEffect(() => {
    for (const state of [sendState, dispatchState, cancelState]) {
      if (!state) continue;
      if (state.ok) toast.success(state.message ?? "Transferência atualizada.");
      else toast.error(state.error);
    }
  }, [sendState, dispatchState, cancelState]);

  const error =
    (sendState && !sendState.ok ? sendState.error : null) ??
    (dispatchState && !dispatchState.ok ? dispatchState.error : null) ??
    (cancelState && !cancelState.ok ? cancelState.error : null);

  return (
    <div className="space-y-3">
      {error ? <FormError message={error} /> : null}

      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" && canSend ? (
          <form action={sendAction}>
            <input type="hidden" name="transferId" value={transferId} />
            <Button type="submit" disabled={isSending || isDispatching}>
              {isSending ? "Enviando…" : "Enviar (baixa na origem)"}
            </Button>
          </form>
        ) : null}

        {status === "SENT" && canSend ? (
          <form action={dispatchAction}>
            <input type="hidden" name="transferId" value={transferId} />
            <Button type="submit" disabled={isSending || isDispatching}>
              {isDispatching ? "Confirmando…" : "Confirmar despacho"}
            </Button>
          </form>
        ) : null}

        {canCancel && (status === "DRAFT" || status === "SENT") && mode === "none" ? (
          <Button type="button" variant="outline" onClick={() => setMode("cancel")}>
            Cancelar
          </Button>
        ) : null}
      </div>

      {mode === "cancel" ? (
        <form action={cancelAction} className="space-y-3 rounded-md border p-3">
          <input type="hidden" name="transferId" value={transferId} />

          <FormField id="cancel-transfer-reason" label="Motivo do cancelamento" required>
            <Input id="cancel-transfer-reason" name="reason" required />
          </FormField>

          <div className="flex gap-2">
            <Button type="submit" variant="destructive" size="sm" disabled={isCancelling}>
              {isCancelling ? "Cancelando…" : "Confirmar"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMode("none")}>
              Voltar
            </Button>
          </div>
        </form>
      ) : null}

      {status === "SENT" ? (
        <p className="text-muted-foreground text-xs">
          O saldo já foi baixado na origem. Cancelar aqui gera a devolução automática.
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Receber / devolver (destino)                                                */
/* -------------------------------------------------------------------------- */

export type ReceivableLine = {
  id: string;
  itemName: string;
  itemCode: string;
  unitCode: string;
  quantitySent: string;
  quantityReceived: string;
};

export function ReceiveTransferActions({
  transferId,
  lines,
  canReceive,
}: {
  transferId: string;
  lines: ReceivableLine[];
  canReceive: boolean;
}) {
  const [mode, setMode] = useState<"none" | "receive" | "return">("none");
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, formatPending(line)])),
  );

  const [receiveState, receiveAction, isReceiving] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(receberTransferenciaAction, null);

  const [returnState, returnAction, isReturning] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(devolverTransferenciaAction, null);

  useEffect(() => {
    for (const state of [receiveState, returnState]) {
      if (!state) continue;
      if (state.ok) toast.success(state.message ?? "Transferência atualizada.");
      else toast.error(state.error);
    }
  }, [receiveState, returnState]);

  if (!canReceive) {
    return (
      <p className="text-muted-foreground text-sm">
        Somente a unidade de destino (ou a matriz) confirma o recebimento.
      </p>
    );
  }

  const error =
    (receiveState && !receiveState.ok ? receiveState.error : null) ??
    (returnState && !returnState.ok ? returnState.error : null);

  const totalPending = lines.reduce(
    (total, line) => total + Math.max(Number(line.quantitySent) - Number(line.quantityReceived), 0),
    0,
  );

  return (
    <div className="space-y-3">
      {error ? <FormError message={error} /> : null}

      {mode === "none" ? (
        <div className="flex flex-wrap gap-2">
          {totalPending > 0 ? (
            <Button type="button" onClick={() => setMode("receive")}>
              Receber material
            </Button>
          ) : null}

          {totalPending > 0 ? (
            <Button type="button" variant="outline" onClick={() => setMode("return")}>
              Devolver
            </Button>
          ) : null}
        </div>
      ) : null}

      {mode === "receive" ? (
        <form action={receiveAction} className="space-y-4 rounded-md border p-3">
          <input type="hidden" name="transferId" value={transferId} />

          <p className="text-sm font-medium">Conferência do recebimento</p>
          <p className="text-muted-foreground text-xs">
            Ajuste a quantidade se recebeu menos do que foi enviado. O que faltar continua em
            trânsito.
          </p>

          <div className="space-y-3">
            {lines.map((line) => {
              const pending = Math.max(
                Number(line.quantitySent) - Number(line.quantityReceived),
                0,
              );

              return (
                <div key={line.id} className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                  <input type="hidden" name="lineId" value={line.id} />

                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{line.itemName}</p>
                    <p className="text-muted-foreground font-mono text-xs">
                      {line.itemCode} · enviado {formatQuantity(line.quantitySent)} {line.unitCode}
                      {Number(line.quantityReceived) > 0
                        ? ` · já recebido ${formatQuantity(line.quantityReceived)}`
                        : ""}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor={`recv-${line.id}`} className="text-xs">
                      Recebido ({line.unitCode})
                    </label>
                    <Input
                      id={`recv-${line.id}`}
                      name="lineQuantityReceived"
                      type="number"
                      step="0.0001"
                      min="0"
                      max={String(pending)}
                      value={quantities[line.id] ?? "0"}
                      onChange={(event) =>
                        setQuantities((current) => ({ ...current, [line.id]: event.target.value }))
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <FormField id="receive-comment" label="Observação">
            <Textarea id="receive-comment" name="comment" rows={2} />
          </FormField>

          <div className="flex gap-2">
            <Button type="submit" disabled={isReceiving}>
              {isReceiving ? "Confirmando…" : "Confirmar recebimento"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("none")}>
              Voltar
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "return" ? (
        <form action={returnAction} className="space-y-3 rounded-md border p-3">
          <input type="hidden" name="transferId" value={transferId} />

          <p className="text-sm font-medium">Devolver o que não chegou</p>
          <p className="text-muted-foreground text-xs">
            O material pendente volta para o saldo da unidade de origem.
          </p>

          <FormField id="return-reason" label="Motivo da devolução" required>
            <Input id="return-reason" name="reason" required />
          </FormField>

          <div className="flex gap-2">
            <Button type="submit" variant="outline" disabled={isReturning}>
              {isReturning ? "Devolvendo…" : "Confirmar devolução"}
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

function formatPending(line: ReceivableLine): string {
  const pending = Number(line.quantitySent) - Number(line.quantityReceived);

  return pending > 0 ? String(pending) : "0";
}
