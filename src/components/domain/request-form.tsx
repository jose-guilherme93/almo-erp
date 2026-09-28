"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
import { ImageInput } from "@/components/domain/image-input";
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

export type RequestableBranch = {
  id: string;
  code: string;
  name: string;
  type: string;
  city: string | null;
};

export type SectorOption = {
  id: string;
  code: string;
  name: string;
};

/**
 * Formulário de solicitação de material.
 *
 * Acessível a qualquer usuário logado. Duas decisões propositais:
 *
 *  - **A unidade é escolhida aqui**, entre todas as unidades ativas. O
 *    colaborador pode estar em outra unidade e precisar de material de lá;
 *    quem resolve o pedido é quem recebe, na unidade escolhida.
 *  - **Não há prioridade.** Quem pede não tem como saber o que é urgente para
 *    a operação — quem separa o material, sim.
 *
 * A solicitação já nasce enviada para aprovação: não existe rascunho.
 */
export function RequestForm({
  branches,
  defaultBranchId,
  sectors,
  defaultSectorId,
}: {
  branches: RequestableBranch[];
  defaultBranchId: string;
  sectors: SectorOption[];
  defaultSectorId: string;
}) {
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [sectorId, setSectorId] = useState(defaultSectorId);
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

  // A disponibilidade é sempre da unidade escolhida: trocar a unidade
  // reconsulta, senão o número exibido mentiria.
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
      <input type="hidden" name="sectorId" value={sectorId} />

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="request-branch"
          label="Unidade"
          required
          hint="O material sai desta unidade."
          errors={fieldErrors["branchId"]}
        >
          <Select
            value={branchId}
            onValueChange={(value) => {
              setBranchId(value);
              setAvailability({});
              void refreshAvailability(lines.map((line) => line.item.id));
            }}
          >
            <SelectTrigger id="request-branch" className="w-full">
              <SelectValue placeholder="Escolha a unidade" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                  {branch.type === "MATRIX" ? " (matriz)" : ""}
                  {branch.city ? ` — ${branch.city}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField id="request-sector" label="Setor" errors={fieldErrors["sectorId"]}>
          <Select value={sectorId} onValueChange={setSectorId}>
            <SelectTrigger id="request-sector" className="w-full">
              <SelectValue placeholder="Seu setor" />
            </SelectTrigger>
            <SelectContent>
              {sectors.map((sector) => (
                <SelectItem key={sector.id} value={sector.id}>
                  {sector.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <p className="text-sm font-medium">Adicionar material</p>
        <ItemCombobox onSelect={addItem} />
        <p className="text-muted-foreground text-xs">
          A disponibilidade mostrada é a da unidade escolhida. Pedir material em falta é permitido —
          quem responde decide o que fazer.
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

      <FormField id="request-notes" label="Observação (opcional)" errors={fieldErrors["notes"]}>
        <Textarea
          id="request-notes"
          name="notes"
          rows={2}
          placeholder="Algo que ajude quem vai separar o material."
        />
      </FormField>

      <ImageInput />

      <Button
        type="submit"
        className="w-full sm:w-auto"
        disabled={isPending || lines.length === 0 || !branchId}
      >
        {isPending ? "Enviando…" : "Enviar pedido"}
      </Button>
    </form>
  );
}
