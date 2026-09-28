"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
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
import { Switch } from "@/components/ui/switch";
import type { ActionResult } from "@/lib/action-result";
import { criarUsuarioAction } from "@/server/actions/usuario";

export type RoleOption = {
  id: string;
  name: string;
  scope: string;
  description: string | null;
};

export type BranchOption = {
  id: string;
  code: string;
  name: string;
  type: string;
};

/**
 * Formulário de cadastro de usuário.
 *
 * O usuário criado entra com o Google usando o e-mail informado — não há
 * senha em nenhum momento (docs/ARQUITETURA.md §4).
 */
export function UserForm({
  roles,
  branches,
  canActivateDirectly,
}: {
  roles: RoleOption[];
  branches: BranchOption[];
  canActivateDirectly: boolean;
}) {
  const [state, formAction, isPending] = useActionState<
    ActionResult<{ userId: string }> | null,
    FormData
  >(criarUsuarioAction, null);

  const [roleId, setRoleId] = useState<string>("");
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [activateNow, setActivateNow] = useState(false);
  const router = useRouter();

  // Em caso de sucesso a própria Server Action redireciona para o detalhe do
  // usuário — aqui só tratamos o erro.
  useEffect(() => {
    if (state && !state.ok) {
      toast.error(state.error);
    }
  }, [state]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const selectedRole = roles.find((role) => role.id === roleId);

  const toggleBranch = (branchId: string) => {
    setSelectedBranches((current) =>
      current.includes(branchId) ? current.filter((id) => id !== branchId) : [...current, branchId],
    );
  };

  return (
    <form action={formAction} className="space-y-6">
      {state && !state.ok ? <FormError message={state.error} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="name" label="Nome completo" required errors={fieldErrors["name"]}>
          <Input
            id="name"
            name="name"
            autoComplete="off"
            required
            aria-invalid={Boolean(fieldErrors["name"])}
          />
        </FormField>

        <FormField
          id="email"
          label="E-mail corporativo"
          required
          hint="Precisa ser do domínio da empresa. É com este e-mail que a pessoa entra."
          errors={fieldErrors["email"]}
        >
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="off"
            placeholder="nome@empresa.com.br"
            required
            aria-invalid={Boolean(fieldErrors["email"])}
          />
        </FormField>
      </div>

      <FormField
        id="roleId"
        label="Perfil"
        required
        errors={fieldErrors["roleId"]}
        hint={selectedRole?.description ?? "Define o que a pessoa pode fazer no sistema."}
      >
        {/* Input espelho: o Select do Radix não participa do FormData nativo. */}
        <input type="hidden" name="roleId" value={roleId} />
        <Select value={roleId} onValueChange={setRoleId}>
          <SelectTrigger
            id="roleId"
            className="w-full"
            aria-invalid={Boolean(fieldErrors["roleId"])}
          >
            <SelectValue placeholder="Selecione o perfil" />
          </SelectTrigger>
          <SelectContent>
            {roles.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {role.name}
                {role.scope === "ALL_BRANCHES" ? " (rede)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField
        id="branchIds"
        label="Unidades"
        required
        errors={fieldErrors["branchIds"]}
        hint="A pessoa terá o mesmo perfil em todas as unidades marcadas."
      >
        <div className="grid gap-2 sm:grid-cols-2" role="group" aria-labelledby="branchIds">
          {branches.map((branch) => (
            <label
              key={branch.id}
              className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <Checkbox
                name="branchIds"
                value={branch.id}
                checked={selectedBranches.includes(branch.id)}
                onCheckedChange={() => toggleBranch(branch.id)}
              />
              <span className="min-w-0">
                <span className="block truncate">{branch.name}</span>
                <span className="text-muted-foreground text-xs">
                  {branch.code}
                  {branch.type === "MATRIX" ? " · matriz" : ""}
                </span>
              </span>
            </label>
          ))}
        </div>
      </FormField>

      {canActivateDirectly ? (
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Ativar acesso imediatamente</p>
            <p className="text-muted-foreground text-xs">
              Sem isso, o usuário fica aguardando aprovação e é ativado no primeiro login com a
              conta corporativa.
            </p>
          </div>

          <Switch
            checked={activateNow}
            onCheckedChange={setActivateNow}
            aria-label="Ativar acesso imediatamente"
          />
        </div>
      ) : null}

      <input type="hidden" name="activateNow" value={activateNow ? "on" : ""} />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Salvando…" : "Cadastrar usuário"}
        </Button>

        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
