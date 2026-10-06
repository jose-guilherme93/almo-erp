"use client";

import { useActionState, useEffect } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { reabrirErroAction, resolverErroAction } from "@/server/actions/erro";

/**
 * Triagem de um erro: marcar como resolvido ou reabrir.
 *
 * Resolver não apaga — o registro fica, porque é ele que mostra se o problema
 * voltou. O que muda é a fila: um erro tratado sai da frente.
 */
export function ErrorLogActions({
  errorLogId,
  resolved,
}: {
  errorLogId: string;
  resolved: boolean;
}) {
  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    resolved ? reabrirErroAction : resolverErroAction,
    null,
  );

  useEffect(() => {
    if (!state) return;

    if (state.ok) toast.success(state.message ?? "Atualizado.");
    else toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction}>
      <input type="hidden" name="errorLogId" value={errorLogId} />

      <Button type="submit" variant={resolved ? "ghost" : "outline"} size="sm" disabled={isPending}>
        {resolved ? (
          <>
            <RotateCcw className="size-4" />
            Reabrir
          </>
        ) : (
          <>
            <CheckCircle2 className="size-4" />
            {isPending ? "Marcando…" : "Marcar como resolvido"}
          </>
        )}
      </Button>
    </form>
  );
}
