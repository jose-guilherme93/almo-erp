"use client";

import { useActionState, useEffect } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { consolidarRelatorioAction } from "@/server/actions/relatorio";

/**
 * Consolida o relatório (snapshot imutável + auditoria) e abre a versão
 * congelada, pronta para imprimir/salvar em PDF.
 */
export function ReportConsolidateForm({
  reportId,
  periodo,
  from,
  to,
  filial,
  categoria,
}: {
  reportId: string;
  periodo: string;
  from: string;
  to: string;
  filial: string;
  categoria: string;
}) {
  const [state, formAction, isPending] = useActionState<
    ActionResult<{ snapshotId: string }> | null,
    FormData
  >(consolidarRelatorioAction, null);

  useEffect(() => {
    if (state && !state.ok) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction}>
      <input type="hidden" name="relatorio" value={reportId} />
      {periodo ? <input type="hidden" name="periodo" value={periodo} /> : null}
      <input type="hidden" name="de" value={from} />
      <input type="hidden" name="ate" value={to} />
      {filial ? <input type="hidden" name="filial" value={filial} /> : null}
      {categoria ? <input type="hidden" name="categoria" value={categoria} /> : null}

      <Button type="submit" disabled={isPending}>
        <Printer className="size-4" />
        {isPending ? "Consolidando…" : "Consolidar e imprimir (PDF)"}
      </Button>
    </form>
  );
}
