"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { salvarConfiguracoesAction } from "@/server/actions/configuracao";

export type ConfigField = {
  key: string;
  label: string;
  description: string;
  type: "string" | "number";
  value: string;
  updatedByName: string | null;
};

/** Formulário de configurações operacionais do sistema. */
export function ConfigForm({ fields }: { fields: ConfigField[] }) {
  const [state, formAction, isPending] = useActionState<
    ActionResult<{ updated: number }> | null,
    FormData
  >(salvarConfiguracoesAction, null);

  useEffect(() => {
    if (!state) return;

    if (state.ok) toast.success(state.message ?? "Configurações salvas.");
    else toast.error(state.error);
  }, [state]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="space-y-5">
      {state && !state.ok ? <FormError message={state.error} /> : null}

      {fields.map((field) => (
        <FormField
          key={field.key}
          id={field.key}
          label={field.label}
          errors={fieldErrors[field.key]}
          hint={
            field.updatedByName
              ? `${field.description} Última alteração por ${field.updatedByName}.`
              : field.description
          }
        >
          <Input
            id={field.key}
            name={field.key}
            type={field.type === "number" ? "number" : "text"}
            step={field.type === "number" ? "1" : undefined}
            defaultValue={field.value}
            inputMode={field.type === "number" ? "numeric" : undefined}
          />
        </FormField>
      ))}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Salvando…" : "Salvar configurações"}
      </Button>
    </form>
  );
}
