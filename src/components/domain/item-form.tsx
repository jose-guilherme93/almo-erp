"use client";

import { useActionState, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { BarcodeScanner } from "@/components/domain/barcode-scanner";
import { FormError, FormField } from "@/components/domain/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { cn } from "@/lib/utils";
import { atualizarItemAction, criarItemAction } from "@/server/actions/item";

export type ItemFormOption = { id: string; name: string; code?: string };
export type CategorySelectOption = { id: string; label: string; requiresApproval: boolean };

export type ItemFormValues = {
  id?: string;
  code: string | null;
  barcode: string | null;
  name: string;
  description: string | null;
  /** Ausente no cadastro: aí vale a `defaultCategoryId` (a "Geral"). */
  categoryId?: string;
  unitId: string;
  referencePrice: string;
  controlledByLot: boolean;
  perishable: boolean;
  requiresApproval: boolean;
  hasSerialControl: boolean;
  /** Série implica patrimônio; desmarcar diz "este material não é um bem". */
  trackAsAsset: boolean;
  active: boolean;
};

/**
 * Formulário de material.
 *
 * Só o estritamente necessário fica visível: nome, unidade e categoria (que já
 * vem em "Geral"). O resto — código, preço, código de barras, descrição e os
 * controles de lote/perecível/série — fica em "Opções avançadas" e continua
 * editável na tela do material.
 *
 * O código do material (SKU) não é campo de formulário: é gerado pelo servidor
 * a partir do prefixo da categoria (`EPI-0001`). Código de identificação de
 * material nunca é digitado — assim nenhum código nasce inconsistente.
 */
export function ItemForm({
  mode,
  units,
  categories,
  defaultCategoryId,
  defaultValues,
}: {
  mode: "create" | "edit";
  units: ItemFormOption[];
  categories: CategorySelectOption[];
  /** Categoria já selecionada por padrão — normalmente a "Geral". */
  defaultCategoryId?: string;
  defaultValues?: ItemFormValues;
}) {
  const action = mode === "create" ? criarItemAction : atualizarItemAction;

  const [categoryId, setCategoryId] = useState(
    defaultValues?.categoryId ?? defaultCategoryId ?? "",
  );
  const [unitId, setUnitId] = useState(defaultValues?.unitId ?? "");
  const [advancedOpen, setAdvancedOpen] = useState(mode === "edit");
  const [controlledByLot, setControlledByLot] = useState(defaultValues?.controlledByLot ?? false);
  const [perishable, setPerishable] = useState(defaultValues?.perishable ?? false);
  const [requiresApproval, setRequiresApproval] = useState(
    defaultValues?.requiresApproval ?? false,
  );
  const [hasSerialControl, setHasSerialControl] = useState(
    defaultValues?.hasSerialControl ?? false,
  );
  const [trackAsAsset, setTrackAsAsset] = useState(defaultValues?.trackAsAsset ?? true);
  const [active, setActive] = useState(defaultValues?.active ?? true);
  const [barcode, setBarcode] = useState(defaultValues?.barcode ?? "");
  const [showScanner, setShowScanner] = useState(false);

  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    action,
    null,
  );

  // Sucesso redireciona no servidor; aqui só tratamos falha.
  useEffect(() => {
    if (state && !state.ok) toast.error(state.error);
  }, [state]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const selectedCategory = categories.find((category) => category.id === categoryId);

  return (
    <form action={formAction} className="space-y-6">
      {defaultValues?.id ? <input type="hidden" name="itemId" value={defaultValues.id} /> : null}
      <input type="hidden" name="categoryId" value={categoryId} />
      <input type="hidden" name="unitId" value={unitId} />
      <input type="hidden" name="controlledByLot" value={controlledByLot ? "on" : ""} />
      <input type="hidden" name="perishable" value={perishable ? "on" : ""} />
      <input type="hidden" name="requiresApproval" value={requiresApproval ? "on" : ""} />
      <input type="hidden" name="hasSerialControl" value={hasSerialControl ? "on" : ""} />
      <input type="hidden" name="trackAsAsset" value={trackAsAsset ? "on" : ""} />
      <input type="hidden" name="active" value={active ? "on" : ""} />

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="item-name"
          label="Nome do material"
          required
          className="sm:col-span-2"
          errors={fieldErrors["name"]}
        >
          <Input id="item-name" name="name" defaultValue={defaultValues?.name} required />
        </FormField>

        <FormField
          id="item-category"
          label="Categoria"
          // No cadastro ela já vem preenchida: não é escolha obrigatória.
          required={mode === "edit"}
          errors={fieldErrors["categoryId"]}
          hint={
            selectedCategory?.requiresApproval
              ? "Esta categoria exige aprovação para saída."
              : undefined
          }
        >
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger id="item-category" className="w-full">
              <SelectValue placeholder="Selecione a categoria" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField id="item-unit" label="Unidade de medida" required errors={fieldErrors["unitId"]}>
          <Select value={unitId} onValueChange={setUnitId}>
            <SelectTrigger id="item-unit" className="w-full">
              <SelectValue placeholder="Selecione a unidade" />
            </SelectTrigger>
            <SelectContent>
              {units.map((unit) => (
                <SelectItem key={unit.id} value={unit.id}>
                  {unit.code} — {unit.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="w-full justify-between">
            <span>Opções avançadas</span>
            <ChevronDown
              className={cn("size-4 transition-transform", advancedOpen && "rotate-180")}
              aria-hidden
            />
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-6 pt-4">
          <p className="text-muted-foreground text-sm">
            Nada aqui é obrigatório. Preencha só se precisar de controle por lote, leitor no balcão
            ou preço de referência.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="item-code"
              label="Código do material"
              hint={
                mode === "create"
                  ? "Gerado automaticamente a partir da categoria (ex.: EPI-0001)."
                  : "Gerado pelo sistema. Não é editável."
              }
            >
              <Input
                id="item-code"
                value={defaultValues?.code ?? ""}
                readOnly
                placeholder={mode === "create" ? "Gerado ao salvar" : undefined}
                aria-readonly="true"
              />
            </FormField>

            <FormField
              id="item-price"
              label="Preço de referência (R$)"
              hint="Usado para estimar o valor da solicitação."
              errors={fieldErrors["referencePrice"]}
            >
              <Input
                id="item-price"
                name="referencePrice"
                type="number"
                step="0.01"
                min="0"
                defaultValue={defaultValues?.referencePrice ?? "0.00"}
                inputMode="decimal"
              />
            </FormField>

            <div className="space-y-2 sm:col-span-2">
              <FormField
                id="item-barcode"
                label="Código de barras"
                hint="Opcional. O dígito verificador é conferido."
                errors={fieldErrors["barcode"]}
              >
                <Input
                  id="item-barcode"
                  name="barcode"
                  value={barcode}
                  onChange={(event) => setBarcode(event.target.value)}
                  inputMode="numeric"
                  placeholder="7891234500014"
                />
              </FormField>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowScanner((current) => !current)}
                aria-expanded={showScanner}
              >
                {showScanner ? "Fechar leitor" : "Ler código de barras"}
              </Button>

              {showScanner ? (
                <BarcodeScanner
                  label="Aponte para o código de barras"
                  onDetected={(code) => {
                    setBarcode(code);
                    setShowScanner(false);
                  }}
                />
              ) : null}
            </div>

            <FormField
              id="item-description"
              label="Descrição"
              className="sm:col-span-2"
              errors={fieldErrors["description"]}
            >
              <Textarea
                id="item-description"
                name="description"
                defaultValue={defaultValues?.description ?? ""}
                rows={3}
              />
            </FormField>
          </div>

          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Controles</legend>

            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                checked={controlledByLot}
                onCheckedChange={(value) => {
                  const next = value === true;
                  setControlledByLot(next);
                  if (!next) setPerishable(false);
                }}
                className="mt-0.5"
              />
              <span>
                Controlado por lote
                <span className="text-muted-foreground block text-xs">
                  Cada entrada deve informar o lote, e as saídas seguem a validade.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                checked={perishable}
                disabled={!controlledByLot}
                onCheckedChange={(value) => setPerishable(value === true)}
                className="mt-0.5"
              />
              <span>
                Perecível / com validade
                <span className="text-muted-foreground block text-xs">
                  {controlledByLot
                    ? "Lotes vencidos não podem ser usados em saída."
                    : "Disponível apenas para materiais controlados por lote."}
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                checked={requiresApproval}
                onCheckedChange={(value) => setRequiresApproval(value === true)}
                className="mt-0.5"
              />
              <span>
                Exige aprovação para saída
                <span className="text-muted-foreground block text-xs">
                  A categoria já pode exigir por padrão; aqui você sobrescreve para este material.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                checked={hasSerialControl}
                onCheckedChange={(value) => {
                  const next = value === true;
                  setHasSerialControl(next);
                  if (!next) setTrackAsAsset(false);
                }}
                className="mt-0.5"
              />
              <span>
                Controle por número de série
                <span className="text-muted-foreground block text-xs">
                  Para equipamentos rastreáveis individualmente, como ferramentas elétricas.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                checked={trackAsAsset}
                disabled={!hasSerialControl}
                onCheckedChange={(value) => setTrackAsAsset(value === true)}
                className="mt-0.5"
              />
              <span>
                É patrimônio (bem rastreável)
                <span className="text-muted-foreground block text-xs">
                  {hasSerialControl
                    ? "Cada unidade recebida vira um bem com etiqueta PAT, dono e histórico."
                    : "Disponível apenas para materiais com controle por número de série."}
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={active} onCheckedChange={(value) => setActive(value === true)} />
              Material ativo
            </label>
          </fieldset>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Salvando…" : mode === "create" ? "Cadastrar material" : "Salvar alterações"}
        </Button>
      </div>
    </form>
  );
}
