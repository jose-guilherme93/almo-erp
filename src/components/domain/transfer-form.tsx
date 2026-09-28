"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
import { ItemCombobox, type ItemOption } from "@/components/domain/item-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { formatQuantity } from "@/lib/format";
import { criarTransferenciaAction } from "@/server/actions/transferencia";

export type BranchOption = { id: string; code: string; name: string };

type Line = { key: string; item: ItemOption; quantity: string };

/**
 * Formulário de transferência.
 *
 * A origem é sempre a unidade ativa; o destino é escolhido entre as demais
 * unidades ativas. A disponibilidade é conferida no envio, não aqui — o
 * saldo pode mudar entre montar e enviar.
 */
export function TransferForm({
  originBranchId,
  originBranchCode,
  destinations,
}: {
  originBranchId: string;
  originBranchCode: string;
  destinations: BranchOption[];
}) {
  const [destinationBranchId, setDestinationBranchId] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [lines, setLines] = useState<Line[]>([]);

  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    criarTransferenciaAction,
    null,
  );

  useEffect(() => {
    if (state && !state.ok) toast.error(state.error);
  }, [state]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  const addItem = (item: ItemOption) => {
    setLines((current) => {
      if (current.some((line) => line.item.id === item.id)) {
        toast.error("Este material já está na transferência.");
        return current;
      }

      return [...current, { key: `${item.id}-${Date.now()}`, item, quantity: "1" }];
    });
  };

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="originBranchId" value={originBranchId} />
      <input type="hidden" name="destinationBranchId" value={destinationBranchId} />
      <input type="hidden" name="priority" value={priority} />

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="origin" label="Origem" hint="Unidade ativa.">
          <Input id="origin" value={originBranchCode} readOnly disabled />
        </FormField>

        <FormField
          id="destination"
          label="Destino"
          required
          errors={fieldErrors["destinationBranchId"]}
        >
          <Select value={destinationBranchId} onValueChange={setDestinationBranchId}>
            <SelectTrigger id="destination" className="w-full">
              <SelectValue placeholder="Selecione a unidade" />
            </SelectTrigger>
            <SelectContent>
              {destinations.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.code} — {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField id="priority" label="Prioridade">
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger id="priority" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="LOW">Baixa</SelectItem>
              <SelectItem value="NORMAL">Normal</SelectItem>
              <SelectItem value="HIGH">Alta</SelectItem>
              <SelectItem value="URGENT">Urgente</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">Adicionar material</p>
        <ItemCombobox onSelect={addItem} />
      </div>

      {lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nenhum material adicionado. Busque acima por nome, código ou código de barras.
        </p>
      ) : (
        <div className="space-y-3">
          {lines.map((line, index) => (
            <div key={line.key} className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{line.item.name}</p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {line.item.code} · {line.item.unit.code}
                  </p>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                >
                  <Trash2 className="size-4" />
                  Remover
                </Button>
              </div>

              <input type="hidden" name="lineItemId" value={line.item.id} />

              <FormField
                id={`transfer-qty-${line.key}`}
                label={`Quantidade (${line.item.unit.code})`}
                required
                errors={fieldErrors[`lines.${index}.quantity`]}
              >
                <Input
                  id={`transfer-qty-${line.key}`}
                  name="lineQuantity"
                  type="number"
                  step="0.0001"
                  min="0"
                  value={line.quantity}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((l) =>
                        l.key === line.key ? { ...l, quantity: event.target.value } : l,
                      ),
                    )
                  }
                  required
                />
              </FormField>
            </div>
          ))}

          <p className="text-muted-foreground text-sm">
            {lines.length} material(is) ·{" "}
            {formatQuantity(
              lines.reduce((total, line) => {
                const value = Number(line.quantity);
                return total + (Number.isFinite(value) ? value : 0);
              }, 0),
            )}{" "}
            no total
          </p>
        </div>
      )}

      <FormField id="transfer-notes" label="Observações" errors={fieldErrors["notes"]}>
        <Textarea id="transfer-notes" name="notes" rows={2} />
      </FormField>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending || lines.length === 0 || !destinationBranchId}>
          {isPending ? "Criando…" : "Criar transferência"}
        </Button>
      </div>

      <p className="text-muted-foreground text-xs">
        A transferência é criada como rascunho. O saldo da origem só é baixado ao enviar.
      </p>
    </form>
  );
}
