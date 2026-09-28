"use client";

import { Pencil, Plus } from "lucide-react";
import { useActionState, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  atualizarLocalEstoqueAction,
  criarLocalEstoqueAction,
  desativarLocalEstoqueAction,
} from "@/server/actions/filial";

const LOCATION_TYPES = [
  { value: "MAIN_WAREHOUSE", label: "Almoxarifado principal" },
  { value: "SECONDARY", label: "Depósito secundário" },
  { value: "QUARANTINE", label: "Quarentena" },
  { value: "TOOLS", label: "Ferramentas" },
  { value: "OTHER", label: "Outro" },
] as const;

export type StorageLocationRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  description: string | null;
  active: boolean;
  responsibleId: string | null;
  responsibleName: string | null;
  stockLevelCount: number;
};

export type PersonOption = { id: string; name: string };

/**
 * Locais físicos de guarda dentro de uma unidade.
 *
 * É o destino dos saldos de estoque: sem local não há onde lançar entrada.
 */
export function StorageLocationManager({
  branchId,
  locations,
  people,
  canManage,
}: {
  branchId: string;
  locations: StorageLocationRow[];
  people: PersonOption[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<StorageLocationRow | null>(null);
  const [creating, setCreating] = useState(false);

  const closeForm = useCallback(() => {
    setCreating(false);
    setEditing(null);
  }, []);

  const [deactivateState, deactivateAction, isDeactivating] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(desativarLocalEstoqueAction, null);

  useEffect(() => {
    if (!deactivateState) return;

    if (deactivateState.ok) {
      toast.success(deactivateState.message ?? "Local desativado.");
    } else {
      toast.error(deactivateState.error);
    }
  }, [deactivateState]);

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-md border">
        {locations.length === 0 ? (
          <li className="text-muted-foreground p-3 text-sm">
            Nenhum local cadastrado. Sem local não é possível lançar estoque.
          </li>
        ) : (
          locations.map((location) => {
            const typeLabel =
              LOCATION_TYPES.find((entry) => entry.value === location.type)?.label ?? location.type;

            return (
              <li
                key={location.id}
                className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium">
                    {location.name}
                    <span className="text-muted-foreground ml-2 text-xs font-normal">
                      {location.code}
                    </span>
                    {!location.active ? (
                      <Badge variant="outline" className="ml-2">
                        inativo
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {typeLabel}
                    {location.responsibleName ? ` · ${location.responsibleName}` : ""}
                    {location.stockLevelCount > 0
                      ? ` · ${location.stockLevelCount} item(ns) com saldo`
                      : ""}
                  </p>
                  {location.description ? (
                    <p className="text-muted-foreground text-xs">{location.description}</p>
                  ) : null}
                </div>

                {canManage ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditing(location);
                        setCreating(false);
                      }}
                    >
                      <Pencil className="size-4" />
                      Editar
                    </Button>

                    {location.active ? (
                      <form action={deactivateAction}>
                        <input type="hidden" name="locationId" value={location.id} />
                        <input type="hidden" name="branchId" value={branchId} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={isDeactivating}
                        >
                          Desativar
                        </Button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })
        )}
      </ul>

      {canManage ? (
        creating || editing ? (
          <LocationForm
            key={editing?.id ?? "novo"}
            branchId={branchId}
            people={people}
            location={editing}
            onDone={closeForm}
          />
        ) : (
          <Button type="button" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Novo local de estoque
          </Button>
        )
      ) : null}
    </div>
  );
}

function LocationForm({
  branchId,
  people,
  location,
  onDone,
}: {
  branchId: string;
  people: PersonOption[];
  location: StorageLocationRow | null;
  onDone: () => void;
}) {
  const isEdit = location !== null;
  const action = isEdit ? atualizarLocalEstoqueAction : criarLocalEstoqueAction;

  const [type, setType] = useState(location?.type ?? "MAIN_WAREHOUSE");
  const [responsibleId, setResponsibleId] = useState(location?.responsibleId ?? "");
  const [active, setActive] = useState(location?.active ?? true);

  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    action,
    null,
  );

  useEffect(() => {
    if (!state) return;

    if (state.ok) {
      toast.success(state.message ?? "Local salvo.");
      onDone();
    } else {
      toast.error(state.error);
    }
  }, [state, onDone]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="space-y-4 rounded-md border p-3">
      <input type="hidden" name="branchId" value={branchId} />
      {isEdit && location ? <input type="hidden" name="locationId" value={location.id} /> : null}
      <input type="hidden" name="type" value={type} />
      <input
        type="hidden"
        name="responsibleId"
        value={responsibleId === "__none__" ? "" : responsibleId}
      />
      <input type="hidden" name="active" value={active ? "on" : ""} />

      <p className="text-sm font-medium">
        {isEdit ? `Editar ${location?.name}` : "Novo local de estoque"}
      </p>

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="location-code" label="Código" required errors={fieldErrors["code"]}>
          <Input
            id="location-code"
            name="code"
            defaultValue={location?.code}
            className="uppercase"
            required
          />
        </FormField>

        <FormField id="location-name" label="Nome" required errors={fieldErrors["name"]}>
          <Input id="location-name" name="name" defaultValue={location?.name} required />
        </FormField>

        <FormField id="location-type" label="Tipo">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="location-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCATION_TYPES.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField id="location-responsible" label="Responsável">
          <Select value={responsibleId} onValueChange={setResponsibleId}>
            <SelectTrigger id="location-responsible" className="w-full">
              <SelectValue placeholder="Selecione a pessoa" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Nenhum</SelectItem>
              {people.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField
          id="location-description"
          label="Descrição"
          className="sm:col-span-2"
          errors={fieldErrors["description"]}
        >
          <Textarea
            id="location-description"
            name="description"
            defaultValue={location?.description ?? ""}
            rows={2}
          />
        </FormField>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox checked={active} onCheckedChange={(value) => setActive(value === true)} />
        Local ativo
      </label>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Salvando…" : isEdit ? "Salvar local" : "Criar local"}
        </Button>

        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
