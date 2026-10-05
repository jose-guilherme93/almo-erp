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
import {
  lancarAjusteAction,
  lancarEntradaAction,
  listarLotesAction,
} from "@/server/actions/estoque";

export type LocationOption = { id: string; code: string; name: string };

type Line = {
  key: string;
  item: ItemOption;
  quantity: string;
  unitCost: string;
  lotId: string;
};

/**
 * Formulário de entrada e de ajuste de estoque.
 *
 * O sinal da quantidade é o que define entrada ou saída — no ajuste o usuário
 * pode informar negativo (quebra, perda, correção para menos).
 */
export function StockDocumentForm({
  mode,
  locations,
  branchCode,
  defaultLocationId,
  lots,
}: {
  mode: "inbound" | "adjustment";
  locations: LocationOption[];
  branchCode: string;
  defaultLocationId: string | null;
  /** Lotes disponíveis por item controlado, para o select da linha. */
  lots: Record<string, Array<{ id: string; code: string; expirationDate: string | null }>>;
}) {
  const action = mode === "inbound" ? lancarEntradaAction : lancarAjusteAction;

  const [locationId, setLocationId] = useState(defaultLocationId ?? locations[0]?.id ?? "");
  const [lines, setLines] = useState<Line[]>([]);
  const [itemLots, setItemLots] = useState(lots);

  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    action,
    null,
  );

  useEffect(() => {
    if (state && !state.ok) toast.error(state.error);
  }, [state]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  const addItem = (item: ItemOption) => {
    if (lines.some((line) => line.item.id === item.id)) {
      toast.error("Este material já está no documento. Ajuste a quantidade na linha existente.");
      return;
    }

    setLines([
      ...lines,
      {
        // Item repetido é bloqueado acima, então o `item.id` é chave única.
        key: item.id,
        item,
        quantity: mode === "inbound" ? "1" : "0",
        unitCost: "0",
        lotId: "",
      },
    ]);

    // Busca os lotes do item na primeira vez que ele entra no documento.
    if (item.controlledByLot && !itemLots[item.id]) {
      void carregarLotes(item.id);
    }
  };

  const carregarLotes = async (itemId: string) => {
    const result = await listarLotesAction(itemId);

    if (!result.ok) return;

    setItemLots((current) => ({ ...current, [itemId]: result.data }));
  };

  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key));
  };

  const totalQuantity = lines.reduce((total, line) => {
    const value = Number(line.quantity);
    return total + (Number.isFinite(value) ? Math.abs(value) : 0);
  }, 0);

  const totalCost = lines.reduce((total, line) => {
    const quantity = Number(line.quantity);
    const cost = Number(line.unitCost);

    return (
      total + (Number.isFinite(quantity) && Number.isFinite(cost) ? Math.abs(quantity) * cost : 0)
    );
  }, 0);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="storageLocationId" value={locationId} />

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField
          id="document-location"
          label="Local de estoque"
          required
          errors={fieldErrors["storageLocationId"]}
          hint={`Unidade ativa: ${branchCode}`}
        >
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger id="document-location" className="w-full">
              <SelectValue placeholder="Selecione o local" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField id="document-date" label="Data" errors={fieldErrors["date"]}>
          <Input
            id="document-date"
            name="date"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </FormField>

        {mode === "inbound" ? (
          <>
            <FormField
              id="document-supplier"
              label="Fornecedor"
              hint="Opcional."
              errors={fieldErrors["supplierName"]}
            >
              <Input id="document-supplier" name="supplierName" />
            </FormField>

            <FormField
              id="document-reference"
              label="Documento de referência"
              hint="Nota fiscal, ordem de serviço, recibo."
              errors={fieldErrors["referenceId"]}
            >
              <Input id="document-reference" name="referenceId" placeholder="NF 12345" />
            </FormField>
          </>
        ) : (
          <FormField
            id="document-justification"
            label="Justificativa"
            required
            className="sm:col-span-2"
            hint="Explique o motivo do ajuste. Fica registrado na auditoria."
            errors={fieldErrors["justification"]}
          >
            <Input
              id="document-justification"
              name="justification"
              placeholder="Ex.: quebra identificada na contagem física"
            />
          </FormField>
        )}
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
          {lines.map((line) => (
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
                  onClick={() => removeLine(line.key)}
                  aria-label={`Remover ${line.item.name}`}
                >
                  <Trash2 className="size-4" />
                  Remover
                </Button>
              </div>

              <input type="hidden" name="lineItemId" value={line.item.id} />

              <div className="grid gap-3 sm:grid-cols-3">
                <FormField
                  id={`qty-${line.key}`}
                  label={`Quantidade (${line.item.unit.code})`}
                  required
                  hint={mode === "adjustment" ? "Use negativo para reduzir o saldo." : undefined}
                  errors={fieldErrors[`lines.${lines.indexOf(line)}.quantity`]}
                >
                  <Input
                    id={`qty-${line.key}`}
                    name="lineQuantity"
                    value={line.quantity}
                    onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                    inputMode="decimal"
                    step="0.0001"
                    type="number"
                    required
                  />
                </FormField>

                <FormField
                  id={`cost-${line.key}`}
                  label="Custo unitário (R$)"
                  errors={fieldErrors[`lines.${lines.indexOf(line)}.unitCost`]}
                >
                  <Input
                    id={`cost-${line.key}`}
                    name="lineUnitCost"
                    value={line.unitCost}
                    onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
                    inputMode="decimal"
                    step="0.01"
                    type="number"
                  />
                </FormField>

                <FormField
                  id={`lot-${line.key}`}
                  label="Lote"
                  required={line.item.controlledByLot}
                  errors={fieldErrors[`lines.${lines.indexOf(line)}.itemLotId`]}
                >
                  <input type="hidden" name="lineLotId" value={line.lotId} />
                  <Select
                    value={line.lotId}
                    onValueChange={(value) => updateLine(line.key, { lotId: value })}
                    disabled={!line.item.controlledByLot}
                  >
                    <SelectTrigger id={`lot-${line.key}`} className="w-full">
                      <SelectValue
                        placeholder={
                          line.item.controlledByLot ? "Selecione o lote" : "Não se aplica"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(itemLots[line.item.id] ?? []).map((lot) => (
                        <SelectItem key={lot.id} value={lot.id}>
                          {lot.code}
                          {lot.expirationDate ? ` — vence ${lot.expirationDate}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
            </div>
          ))}

          <div className="text-muted-foreground flex flex-wrap justify-between gap-2 text-sm">
            <span>{lines.length} material(is)</span>
            <span>
              Total: {formatQuantity(totalQuantity)} ·{" "}
              {totalCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </span>
          </div>
        </div>
      )}

      <FormField id="document-notes" label="Observações" errors={fieldErrors["notes"]}>
        <Textarea id="document-notes" name="notes" rows={2} />
      </FormField>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending || lines.length === 0}>
          {isPending ? "Lançando…" : mode === "inbound" ? "Lançar entrada" : "Lançar ajuste"}
        </Button>

        <Button type="button" variant="ghost" disabled={isPending} onClick={() => setLines([])}>
          Limpar materiais
        </Button>
      </div>
    </form>
  );
}
