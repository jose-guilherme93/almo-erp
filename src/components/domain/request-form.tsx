"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
import { ItemCombobox, type ItemOption } from "@/components/domain/item-combobox";
import { Badge } from "@/components/ui/badge";
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
  consultarDisponibilidadeAction,
  criarSolicitacaoAction,
} from "@/server/actions/solicitacao";

type Line = { key: string; item: ItemOption; quantity: string; notes: string };

const PRIORITIES = [
  { value: "LOW", label: "Baixa", hint: "Sem urgência; entra na fila normal." },
  { value: "NORMAL", label: "Normal", hint: "Prazo habitual da unidade." },
  { value: "HIGH", label: "Alta", hint: "Precisa de atenção; sobe na fila." },
  { value: "URGENT", label: "Urgente", hint: "Parada de operação; primeiro da fila." },
];

/**
 * Formulário de solicitação de material.
 *
 * Acessível a qualquer usuário logado com vínculo em unidade — é a porta de
 * entrada do sistema para quem não é da administração.
 */
export function RequestForm({ branchId, branchCode }: { branchId: string; branchCode: string }) {
  const [priority, setPriority] = useState("NORMAL");
  const [lines, setLines] = useState<Line[]>([]);
  const [availability, setAvailability] = useState<
    Record<string, { available: string; status: string }>
  >({});

  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    criarSolicitacaoAction,
    null,
  );

  useEffect(() => {
    if (state && !state.ok) toast.error(state.error);
  }, [state]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  const refreshAvailability = async (itemIds: string[]) => {
    if (itemIds.length === 0) return;

    const result = await consultarDisponibilidadeAction(branchId, itemIds);

    if (result.ok) setAvailability(result.data);
  };

  const addItem = (item: ItemOption) => {
    setLines((current) => {
      if (current.some((line) => line.item.id === item.id)) {
        toast.error("Este material já está na solicitação. Ajuste a quantidade na linha.");
        return current;
      }

      const next = [
        ...current,
        { key: `${item.id}-${Date.now()}`, item, quantity: "1", notes: "" },
      ];

      void refreshAvailability(next.map((line) => line.item.id));

      return next;
    });
  };

  const removeItem = (key: string) => {
    setLines((current) => {
      const next = current.filter((line) => line.key !== key);
      return next;
    });
  };

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="priority" value={priority} />

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="request-branch" label="Unidade" hint="A entrega sai desta unidade.">
          <Input id="request-branch" value={branchCode} readOnly disabled />
        </FormField>

        <FormField
          id="request-priority"
          label="Prioridade"
          hint={PRIORITIES.find((entry) => entry.value === priority)?.hint}
        >
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger id="request-priority" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField
          id="request-needed-at"
          label="Precisa para"
          hint="Opcional. Ajuda a priorizar a fila."
          errors={fieldErrors["neededAt"]}
        >
          <Input id="request-needed-at" name="neededAt" type="date" />
        </FormField>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">Adicionar material</p>
        <ItemCombobox onSelect={addItem} />
        <p className="text-muted-foreground text-xs">
          A disponibilidade mostrada é a da sua unidade agora. Pedir material em falta é permitido —
          o aprovador decide o que fazer.
        </p>
      </div>

      {lines.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nenhum material adicionado. Busque acima por nome, código ou código de barras.
        </p>
      ) : (
        <div className="space-y-3">
          {lines.map((line, index) => {
            const info = availability[line.item.id];
            const available = info ? Number(info.available) : null;
            const requested = Number(line.quantity);
            const insufficient =
              available !== null && Number.isFinite(requested) && requested > available;

            return (
              <div key={line.key} className="space-y-3 rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{line.item.name}</p>
                    <p className="text-muted-foreground font-mono text-xs">
                      {line.item.code} · {line.item.unit.code} · {line.item.category.name}
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => removeItem(line.key)}
                    aria-label={`Remover ${line.item.name}`}
                  >
                    <Trash2 className="size-4" />
                    Remover
                  </Button>
                </div>

                <input type="hidden" name="lineItemId" value={line.item.id} />

                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField
                    id={`request-qty-${line.key}`}
                    label={`Quantidade (${line.item.unit.code})`}
                    required
                    errors={fieldErrors[`lines.${index}.quantity`]}
                  >
                    <Input
                      id={`request-qty-${line.key}`}
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

                  <FormField
                    id={`request-notes-${line.key}`}
                    label="Observação do item"
                    hint="Ex.: precisa ser tamanho M."
                    errors={fieldErrors[`lines.${index}.lineNotes`]}
                  >
                    <Input
                      id={`request-notes-${line.key}`}
                      name="lineNotes"
                      value={line.notes}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((l) =>
                            l.key === line.key ? { ...l, notes: event.target.value } : l,
                          ),
                        )
                      }
                    />
                  </FormField>
                </div>

                {available !== null ? (
                  <p className="text-xs">
                    {insufficient ? (
                      <Badge variant="outline" className="border-amber-300 text-amber-700">
                        disponível agora: {formatQuantity(info?.available ?? "0")} — pode ser
                        aprovado parcialmente
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">
                        disponível agora: {formatQuantity(info?.available ?? "0")}
                      </span>
                    )}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <FormField id="request-notes" label="Justificativa do pedido" errors={fieldErrors["notes"]}>
        <Textarea
          id="request-notes"
          name="notes"
          rows={3}
          placeholder="Para que o material será usado, se for algo fora do rotineiro."
        />
      </FormField>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending || lines.length === 0}>
          {isPending ? "Criando…" : "Criar solicitação"}
        </Button>
      </div>

      <p className="text-muted-foreground text-xs">
        A solicitação é criada como rascunho. Ela só vai para aprovação quando você enviar.
      </p>
    </form>
  );
}
