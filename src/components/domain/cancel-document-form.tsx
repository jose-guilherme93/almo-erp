"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError } from "@/components/domain/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { cancelarDocumentoAction } from "@/server/actions/estoque";

/** Cancelamento de movimentação: exige motivo e mostra o aviso do estorno. */
export function CancelDocumentForm({ documentId }: { documentId: string }) {
  const [confirming, setConfirming] = useState(false);

  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    cancelarDocumentoAction,
    null,
  );

  // Fecha a confirmação quando o cancelamento dá certo. Ajustar o estado
  // durante a renderização evita render em cascata.
  const [handledState, setHandledState] = useState<typeof state>(null);

  if (state !== handledState) {
    setHandledState(state);
    if (state?.ok) setConfirming(false);
  }

  useEffect(() => {
    if (!state) return;

    if (state.ok) {
      toast.success(state.message ?? "Movimentação cancelada.");
    } else {
      toast.error(state.error);
    }
  }, [state]);

  if (!confirming) {
    return (
      <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
        Cancelar movimentação
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="documentId" value={documentId} />

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <div className="space-y-1.5">
        <label htmlFor="cancel-reason" className="text-sm font-medium">
          Motivo do cancelamento
        </label>
        <Input
          id="cancel-reason"
          name="reason"
          placeholder="Ex.: lançamento em duplicidade"
          required
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" variant="destructive" size="sm" disabled={isPending}>
          {isPending ? "Cancelando…" : "Confirmar cancelamento"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(false)}
          disabled={isPending}
        >
          Voltar
        </Button>
      </div>
    </form>
  );
}
