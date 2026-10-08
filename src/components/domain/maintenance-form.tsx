"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
import { ImageInput } from "@/components/domain/image-input";
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
import { MAINTENANCE_CATEGORIES } from "@/lib/validation/maintenance";
import { abrirReparoAction } from "@/server/actions/manutencao";

export type MaintenanceBranchOption = {
  id: string;
  code: string;
  name: string;
  type: string;
  city: string | null;
};

export type MaintenanceSectorOption = {
  id: string;
  code: string;
  name: string;
};

/**
 * Abertura de chamado de reparo.
 *
 * Sem prioridade: quem abre descreve o problema, quem recebe decide se é
 * urgente. A unidade também é escolhida aqui, entre todas as ativas.
 */
export function MaintenanceForm({
  branches,
  defaultBranchId,
  sectors,
  defaultSectorId,
  defaultCategory = "",
}: {
  branches: MaintenanceBranchOption[];
  defaultBranchId: string;
  sectors: MaintenanceSectorOption[];
  defaultSectorId: string;
  defaultCategory?: string;
}) {
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [sectorId, setSectorId] = useState(defaultSectorId);
  const [category, setCategory] = useState(defaultCategory);

  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    abrirReparoAction,
    null,
  );

  useEffect(() => {
    if (state && !state.ok) toast.error(state.error);
  }, [state]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="sectorId" value={sectorId} />
      <input type="hidden" name="category" value={category} />

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="maintenance-branch"
          label="Unidade"
          required
          errors={fieldErrors["branchId"]}
        >
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger id="maintenance-branch" className="w-full">
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

        <FormField id="maintenance-sector" label="Setor" errors={fieldErrors["sectorId"]}>
          <Select value={sectorId} onValueChange={setSectorId}>
            <SelectTrigger id="maintenance-sector" className="w-full">
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

      <FormField
        id="maintenance-category"
        label="Tipo de problema"
        required
        errors={fieldErrors["category"]}
        hint={MAINTENANCE_CATEGORIES.find((entry) => entry.value === category)?.hint}
      >
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger id="maintenance-category" className="w-full">
            <SelectValue placeholder="Escolha o tipo" />
          </SelectTrigger>
          <SelectContent>
            {MAINTENANCE_CATEGORIES.map((entry) => (
              <SelectItem key={entry.value} value={entry.value}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField
        id="maintenance-title"
        label="Resuma o problema"
        required
        hint="Uma frase, como você contaria para o colega."
        errors={fieldErrors["title"]}
      >
        <Input
          id="maintenance-title"
          name="title"
          placeholder="Ar-condicionado não está gelando"
          maxLength={120}
          required
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="maintenance-location"
          label="Onde exatamente?"
          required
          hint="Sala, andar, setor. Ajuda a equipe a chegar no lugar certo."
          errors={fieldErrors["location"]}
        >
          <Input
            id="maintenance-location"
            name="location"
            placeholder="Sala 3 — 2º andar"
            maxLength={120}
            required
          />
        </FormField>

        <FormField
          id="maintenance-asset-tag"
          label="Identificação do equipamento"
          hint="Opcional. Se for a etiqueta de um bem cadastrado (ex.: PAT-000123), o chamado fica vinculado ao patrimônio e ele entra em manutenção."
          errors={fieldErrors["assetTag"]}
        >
          <Input id="maintenance-asset-tag" name="assetTag" placeholder="PAT-000123" />
        </FormField>
      </div>

      <FormField
        id="maintenance-description"
        label="Descreva o problema"
        required
        hint="O que está acontecendo, desde quando e se já tentou alguma coisa."
        errors={fieldErrors["description"]}
      >
        <Textarea
          id="maintenance-description"
          name="description"
          rows={5}
          placeholder="Desde ontem à tarde o aparelho liga mas não gela. Já verificamos que a tomada funciona."
          required
        />
      </FormField>

      <ImageInput />

      <Button
        type="submit"
        className="w-full sm:w-auto"
        disabled={isPending || !branchId || category === ""}
      >
        {isPending ? "Abrindo…" : "Abrir chamado"}
      </Button>
    </form>
  );
}
