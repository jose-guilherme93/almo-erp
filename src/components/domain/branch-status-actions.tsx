"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError } from "@/components/domain/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { desativarFilialAction, reativarFilialAction } from "@/server/actions/filial";

/**
 * Ativar e desativar unidade.
 *
 * Desativar pode ser bloqueado por pendências (transferência em trânsito,
 * inventário aberto, saldo em estoque) — nesse caso o motivo vem do servidor.
 */
export function BranchStatusActions({
  branchId,
  active,
  isMatrix,
}: {
  branchId: string;
  active: boolean;
  isMatrix: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  const action = active ? desativarFilialAction : reativarFilialAction;

  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    action,
    null,
  );

  // Fecha a confirmação quando a desativação dá certo. Ajuste durante a
  // renderização evita render em cascata (o lint do React proíbe setState
  // dentro de efeito).
  const [handledState, setHandledState] = useState<typeof state>(null);

  if (state !== handledState) {
    setHandledState(state);
    if (state?.ok) setConfirming(false);
  }

  useEffect(() => {
    if (!state) return;

    if (state.ok) {
      toast.success(state.message ?? "Unidade atualizada.");
    } else {
      toast.error(state.error);
    }
  }, [state]);

  if (isMatrix) {
    return (
      <p className="text-muted-foreground text-sm">
        A matriz não pode ser desativada: ela é a referência da rede.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {state && !state.ok ? <FormError message={state.error} /> : null}

      {active ? (
        confirming ? (
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="branchId" value={branchId} />

            <div className="space-y-1.5">
              <label htmlFor="reason" className="text-sm font-medium">
                Motivo da desativação (opcional)
              </label>
              <Input
                id="reason"
                name="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ex.: unidade transferida para novo endereço"
              />
            </div>

            <div className="flex gap-2">
              <Button type="submit" variant="destructive" size="sm" disabled={isPending}>
                {isPending ? "Desativando…" : "Confirmar desativação"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(false)}
                disabled={isPending}
              >
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
            Desativar unidade
          </Button>
        )
      ) : (
        <form action={formAction}>
          <input type="hidden" name="branchId" value={branchId} />
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Reativando…" : "Reativar unidade"}
          </Button>
        </form>
      )}

      <p className="text-muted-foreground text-xs">
        Unidade inativa não aceita novas solicitações nem movimentações, mas continua legível para
        auditoria.
      </p>
    </div>
  );
}
