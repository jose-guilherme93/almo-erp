"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { permissionsByGroup } from "@/lib/permissions/catalog";
import { cn } from "@/lib/utils";
import { atualizarPapelAction, criarPapelAction } from "@/server/actions/papel";

export type RoleFormMode = "create" | "edit";

/**
 * Formulário de perfil com o catálogo de permissões agrupado por recurso.
 *
 * As permissões chegam do `catalog.ts` (fonte única), nunca digitadas à mão.
 */
export function RoleForm({
  mode,
  roleId,
  defaultValues,
  isSystem,
}: {
  mode: RoleFormMode;
  roleId?: string;
  defaultValues?: {
    name: string;
    description: string | null;
    scope: "ALL_BRANCHES" | "OWN_BRANCHES";
    permissionKeys: string[];
  };
  isSystem?: boolean;
}) {
  const router = useRouter();
  const groups = permissionsByGroup();

  const [selected, setSelected] = useState<string[]>(defaultValues?.permissionKeys ?? []);
  const [name, setName] = useState(defaultValues?.name ?? "");
  const [scope, setScope] = useState<"ALL_BRANCHES" | "OWN_BRANCHES">(
    defaultValues?.scope ?? "OWN_BRANCHES",
  );

  const action = mode === "create" ? criarPapelAction : atualizarPapelAction;

  const [state, formAction, isPending] = useActionState<
    ActionResult<{ roleId: string }> | null,
    FormData
  >(action, null);

  // Sucesso redireciona no servidor; aqui só tratamos falha de validação.
  useEffect(() => {
    if (state && !state.ok) {
      toast.error(state.error);
    }
  }, [state]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  const toggle = (key: string) => {
    setSelected((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };

  const toggleGroup = (keys: string[], checked: boolean) => {
    setSelected((current) =>
      checked ? [...new Set([...current, ...keys])] : current.filter((key) => !keys.includes(key)),
    );
  };

  return (
    <form action={formAction} className="space-y-6">
      {roleId ? <input type="hidden" name="roleId" value={roleId} /> : null}

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="role-name" label="Nome do perfil" required errors={fieldErrors["name"]}>
          <Input
            id="role-name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </FormField>

        <FormField
          id="role-scope"
          label="Escopo"
          required
          hint={
            isSystem
              ? "Perfis de sistema têm o escopo fixo."
              : scope === "ALL_BRANCHES"
                ? "Vale em todas as unidades, inclusive novas."
                : "Vale somente nas unidades onde o usuário tiver vínculo."
          }
          errors={fieldErrors["scope"]}
        >
          <div className="flex gap-2">
            {(
              [
                { value: "OWN_BRANCHES", label: "Somente a unidade" },
                { value: "ALL_BRANCHES", label: "Toda a rede" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={isSystem}
                onClick={() => setScope(option.value)}
                aria-pressed={scope === option.value}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm transition-colors",
                  scope === option.value
                    ? "border-primary bg-accent text-accent-foreground font-medium"
                    : "hover:bg-accent/50",
                  isSystem ? "cursor-not-allowed opacity-60" : "",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </FormField>
      </div>

      <input type="hidden" name="scope" value={scope} />

      <FormField
        id="role-description"
        label="Descrição"
        hint="Explique em uma frase para que serve este perfil."
        errors={fieldErrors["description"]}
      >
        <Textarea
          id="role-description"
          name="description"
          defaultValue={defaultValues?.description ?? ""}
          rows={2}
          maxLength={300}
        />
      </FormField>

      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">Permissões</p>
          <p className="text-muted-foreground text-xs">
            {selected.length} selecionada(s) de{" "}
            {groups.reduce((sum, g) => sum + g.permissions.length, 0)}
          </p>
        </div>

        {state && !state.ok && fieldErrors["permissions"] ? (
          <FormError message={fieldErrors["permissions"].join(" ")} />
        ) : null}

        <div className="space-y-3">
          {groups.map((group) => {
            const keys = group.permissions.map((permission) => permission.key);
            const allSelected = keys.every((key) => selected.includes(key));

            return (
              <fieldset key={group.group} className="rounded-md border">
                <legend className="flex items-center gap-2 px-3 py-2">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(value) => toggleGroup(keys, value === true)}
                    aria-label={`Selecionar todas as permissões de ${group.group}`}
                  />
                  <span className="text-sm font-medium">{group.group}</span>
                </legend>

                <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.permissions.map((permission) => (
                    <label
                      key={permission.key}
                      className="flex cursor-pointer items-start gap-2 text-sm"
                      title={permission.description}
                    >
                      <Checkbox
                        name="permissions"
                        value={permission.key}
                        checked={selected.includes(permission.key)}
                        onCheckedChange={() => toggle(permission.key)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block">{permission.action}</span>
                        <span className="text-muted-foreground block text-xs">
                          {permission.resource}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Salvando…" : mode === "create" ? "Criar perfil" : "Salvar permissões"}
        </Button>

        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
