"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { FormField } from "@/components/domain/form-field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import {
  assumirEtapaAction,
  cancelarEtapaAction,
  concluirEtapaAction,
  devolverEtapaAction,
  encaminharEtapaAction,
} from "@/server/actions/delegacao";

export type DelegationSector = { id: string; name: string };

/** Encaminha uma etapa da demanda para outro setor. */
export function EncaminharEtapaForm({
  entityType,
  entityId,
  sectors,
}: {
  entityType: "REQUEST" | "MAINTENANCE";
  entityId: string;
  sectors: DelegationSector[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    encaminharEtapaAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message ?? "Etapa encaminhada.");
    else toast.error(state.error);
  }, [state]);

  if (sectors.length === 0) return null;

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Encaminhar para outro setor
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-md border p-3">
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="entityId" value={entityId} />

      <FormField
        id="delegation-sector"
        label="Setor de destino"
        required
        errors={state && !state.ok ? state.fieldErrors?.["toSectorId"] : undefined}
      >
        <select
          id="delegation-sector"
          name="toSectorId"
          required
          className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
        >
          <option value="">Escolha o setor…</option>
          {sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </select>
      </FormField>

      <FormField
        id="delegation-reason"
        label="O que o setor precisa fazer?"
        required
        errors={state && !state.ok ? state.fieldErrors?.["reason"] : undefined}
      >
        <Textarea
          id="delegation-reason"
          name="reason"
          rows={3}
          required
          placeholder="Ex.: analisar se o defeito é de fabricação ou mau uso."
        />
      </FormField>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Encaminhando…" : "Encaminhar"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/** Ações do setor de destino (assumir) e do setor de origem (devolver/cancelar). */
export function DelegationActions({
  delegationId,
  status,
  isTargetSector,
  isOriginSector,
  canCancel,
}: {
  delegationId: string;
  status: string;
  isTargetSector: boolean;
  isOriginSector: boolean;
  canCancel: boolean;
}) {
  const [acceptState, acceptAction, acceptPending] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(assumirEtapaAction, null);
  const [completeState, completeAction, completePending] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(concluirEtapaAction, null);
  const [returnState, returnAction, returnPending] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(devolverEtapaAction, null);
  const [cancelState, cancelAction, cancelPending] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(cancelarEtapaAction, null);
  const [showComplete, setShowComplete] = useState(false);
  const reportRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    for (const state of [acceptState, completeState, returnState, cancelState]) {
      if (!state) continue;
      if (state.ok) toast.success(state.message ?? "Feito.");
      else toast.error(state.error);
    }
  }, [acceptState, completeState, returnState, cancelState]);

  const isOpen = ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(status);

  return (
    <div className="flex flex-wrap items-start gap-2">
      {isTargetSector && isOpen && status === "PENDING" ? (
        <form action={acceptAction}>
          <input type="hidden" name="delegationId" value={delegationId} />
          <Button type="submit" size="sm" disabled={acceptPending}>
            {acceptPending ? "Assumindo…" : "Assumir etapa"}
          </Button>
        </form>
      ) : null}

      {isTargetSector && isOpen && status !== "PENDING" && !showComplete ? (
        <Button type="button" size="sm" onClick={() => setShowComplete(true)}>
          Concluir com laudo
        </Button>
      ) : null}

      {isTargetSector && isOpen && showComplete ? (
        <form action={completeAction} className="w-full space-y-2">
          <input type="hidden" name="delegationId" value={delegationId} />
          <Textarea
            ref={reportRef}
            name="report"
            rows={3}
            required
            placeholder="Laudo: o que foi verificado e a conclusão (ex.: necessária troca da placa-mãe)."
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={completePending}>
              {completePending ? "Enviando…" : "Registrar laudo e concluir"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowComplete(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}

      {isOriginSector && status === "COMPLETED" ? (
        <form action={returnAction}>
          <input type="hidden" name="delegationId" value={delegationId} />
          <Button type="submit" size="sm" variant="outline" disabled={returnPending}>
            {returnPending ? "Encerrando…" : "Encerrar etapa e retomar"}
          </Button>
        </form>
      ) : null}

      {canCancel && isOpen ? (
        <form action={cancelAction}>
          <input type="hidden" name="delegationId" value={delegationId} />
          <Button type="submit" size="sm" variant="ghost" disabled={cancelPending}>
            Cancelar encaminhamento
          </Button>
        </form>
      ) : null}
    </div>
  );
}
