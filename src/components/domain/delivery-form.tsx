"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { formatQuantity } from "@/lib/format";
import { registrarEntregaAction } from "@/server/actions/solicitacao";

export type DeliveryLine = {
  id: string;
  itemName: string;
  itemCode: string;
  unitCode: string;
  approvedQuantity: string;
  reservedQuantity: string;
  storageLocationName: string | null;
};

/**
 * Conferência e registro da entrega.
 *
 * O almoxarife ajusta a quantidade realmente entregue — pode ser menor que a
 * aprovada. O que sobrar da reserva volta automaticamente para o disponível.
 */
export function DeliveryForm({
  requestId,
  requestNumber,
  requesterName,
  lines,
}: {
  requestId: string;
  requestNumber: string;
  requesterName: string;
  lines: DeliveryLine[];
}) {
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, line.reservedQuantity])),
  );

  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    registrarEntregaAction,
    null,
  );

  useEffect(() => {
    if (state && !state.ok) toast.error(state.error);
  }, [state]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  const totalDelivering = lines.reduce((total, line) => {
    const value = Number(quantities[line.id] ?? "0");
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);

  const totalReserved = lines.reduce((total, line) => total + Number(line.reservedQuantity), 0);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="requestId" value={requestId} />

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <div className="rounded-md border p-3 text-sm">
        <p>
          <span className="font-medium">{requestNumber}</span> · solicitado por {requesterName}
        </p>
        <p className="text-muted-foreground text-xs">
          Local de retirada: {lines[0]?.storageLocationName ?? "almoxarifado principal da unidade"}
        </p>
      </div>

      <div className="space-y-3">
        {lines.map((line) => {
          const delivering = Number(quantities[line.id] ?? "0");
          const reserved = Number(line.reservedQuantity);
          const diverges = Number.isFinite(delivering) && delivering !== reserved;

          return (
            <div key={line.id} className="space-y-2 rounded-md border p-3">
              <input type="hidden" name="lineId" value={line.id} />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{line.itemName}</p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {line.itemCode} · aprovado {formatQuantity(line.approvedQuantity)}{" "}
                    {line.unitCode}
                    {line.reservedQuantity !== line.approvedQuantity
                      ? ` · reservado ${formatQuantity(line.reservedQuantity)}`
                      : ""}
                  </p>
                </div>

                {diverges ? (
                  <span className="text-xs text-amber-700">
                    diferença de {formatQuantity(Math.abs(reserved - delivering))} — o restante
                    volta ao estoque
                  </span>
                ) : null}
              </div>

              <div className="max-w-xs space-y-1">
                <label htmlFor={`deliver-${line.id}`} className="text-xs">
                  Entregando ({line.unitCode})
                </label>
                <Input
                  id={`deliver-${line.id}`}
                  name="lineDeliveredQuantity"
                  type="number"
                  step="0.0001"
                  min="0"
                  max={line.reservedQuantity}
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

      <p className="text-muted-foreground text-sm">
        Entregando {formatQuantity(totalDelivering)} de {formatQuantity(totalReserved)} reservados.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="received-by-name"
          label="Quem recebeu"
          required
          hint="Nome de quem retirou o material."
          errors={fieldErrors["receivedByName"]}
        >
          <Input id="received-by-name" name="receivedByName" required />
        </FormField>

        <FormField
          id="received-by-document"
          label="CPF de quem recebeu"
          hint="Opcional, mas recomendado para rastreabilidade."
          errors={fieldErrors["receivedByDocument"]}
        >
          <Input id="received-by-document" name="receivedByDocument" inputMode="numeric" />
        </FormField>
      </div>

      <FormField id="delivery-notes" label="Observação" errors={fieldErrors["notes"]}>
        <Textarea id="delivery-notes" name="notes" rows={2} />
      </FormField>

      <Button type="submit" disabled={isPending || totalDelivering <= 0}>
        {isPending ? "Registrando…" : "Confirmar entrega e dar baixa no estoque"}
      </Button>
    </form>
  );
}
