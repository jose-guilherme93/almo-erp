"use client";

import { Pencil, Plus } from "lucide-react";
import { useActionState, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import {
  atualizarUnidadeMedidaAction,
  criarUnidadeMedidaAction,
  desativarUnidadeMedidaAction,
} from "@/server/actions/catalogo";

export type UnitRow = {
  id: string;
  code: string;
  name: string;
  allowsDecimals: boolean;
  isSystem: boolean;
  active: boolean;
  itemCount: number;
};

export function UnitManager({ units, canManage }: { units: UnitRow[]; canManage: boolean }) {
  const [editing, setEditing] = useState<UnitRow | null>(null);
  const [creating, setCreating] = useState(false);

  const close = useCallback(() => {
    setCreating(false);
    setEditing(null);
  }, []);

  const [state, action, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    desativarUnidadeMedidaAction,
    null,
  );

  useEffect(() => {
    if (!state) return;

    if (state.ok) toast.success(state.message ?? "Unidade desativada.");
    else toast.error(state.error);
  }, [state]);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <caption className="sr-only">Unidades de medida cadastradas</caption>
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Código
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Nome
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Casas decimais
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Materiais
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Situação
              </th>
              {canManage ? (
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Ações
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y">
            {units.map((unit) => (
              <tr key={unit.id}>
                <td className="px-3 py-2 font-mono">{unit.code}</td>
                <td className="px-3 py-2">
                  {unit.name}
                  {unit.isSystem ? (
                    <Badge variant="outline" className="ml-2">
                      padrão
                    </Badge>
                  ) : null}
                </td>
                <td className="text-muted-foreground px-3 py-2">
                  {unit.allowsDecimals ? "Sim" : "Não"}
                </td>
                <td className="px-3 py-2 text-right">{unit.itemCount}</td>
                <td className="px-3 py-2">
                  <Badge variant={unit.active ? "secondary" : "outline"}>
                    {unit.active ? "Ativa" : "Inativa"}
                  </Badge>
                </td>
                {canManage ? (
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(unit);
                          setCreating(false);
                        }}
                      >
                        <Pencil className="size-4" />
                        Editar
                      </Button>

                      {unit.active && !unit.isSystem ? (
                        <form action={action}>
                          <input type="hidden" name="unitId" value={unit.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            disabled={isPending}
                          >
                            Desativar
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage ? (
        creating || editing ? (
          <UnitForm key={editing?.id ?? "nova"} unit={editing} onDone={close} />
        ) : (
          <Button type="button" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Nova unidade de medida
          </Button>
        )
      ) : null}
    </div>
  );
}

function UnitForm({ unit, onDone }: { unit: UnitRow | null; onDone: () => void }) {
  const isEdit = unit !== null;
  const action = isEdit ? atualizarUnidadeMedidaAction : criarUnidadeMedidaAction;

  const [allowsDecimals, setAllowsDecimals] = useState(unit?.allowsDecimals ?? false);
  const [active, setActive] = useState(unit?.active ?? true);

  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    action,
    null,
  );

  useEffect(() => {
    if (!state) return;

    if (state.ok) {
      toast.success(state.message ?? "Unidade de medida salva.");
      onDone();
    } else {
      toast.error(state.error);
    }
  }, [state, onDone]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="space-y-4 rounded-md border p-3">
      {isEdit && unit ? <input type="hidden" name="unitId" value={unit.id} /> : null}
      <input type="hidden" name="allowsDecimals" value={allowsDecimals ? "on" : ""} />
      <input type="hidden" name="active" value={active ? "on" : ""} />

      <p className="text-sm font-medium">
        {isEdit ? `Editar ${unit?.name}` : "Nova unidade de medida"}
      </p>

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          id="unit-code"
          label="Código"
          required
          hint="Até 6 caracteres. Ex.: UN, CX, KG."
          errors={fieldErrors["code"]}
        >
          <Input
            id="unit-code"
            name="code"
            defaultValue={unit?.code}
            className="uppercase"
            maxLength={6}
            required
          />
        </FormField>

        <FormField id="unit-name" label="Nome" required errors={fieldErrors["name"]}>
          <Input id="unit-name" name="name" defaultValue={unit?.name} required />
        </FormField>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={allowsDecimals}
            onCheckedChange={(value) => setAllowsDecimals(value === true)}
          />
          Aceita quantidade fracionada
        </label>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={active} onCheckedChange={(value) => setActive(value === true)} />
          Ativa
        </label>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Salvando…" : isEdit ? "Salvar" : "Criar"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
