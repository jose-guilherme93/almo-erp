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
import type { ActionResult } from "@/lib/action-result";
import { isValidPattern, matchesEmailPattern } from "@/lib/email-policy";
import {
  criarPoliticaEmailAction,
  atualizarPoliticaEmailAction,
} from "@/server/actions/politica-email";

type Option = { id: string; name: string };

/**
 * Formulário de política de e-mail.
 *
 * O `pattern` é validado e testado **antes de salvar**: uma regex quebrada
 * poderia barrar todo mundo do domínio, então o admin vê o resultado do teste
 * contra um e-mail de exemplo ali mesmo.
 */
export function EmailPolicyForm({
  mode,
  policyId,
  roles,
  branches,
  defaultValues,
}: {
  mode: "create" | "edit";
  policyId?: string;
  roles: Option[];
  branches: Option[];
  defaultValues?: {
    domain: string;
    pattern: string | null;
    autoApprove: boolean;
    defaultRoleId: string | null;
    defaultBranchId: string | null;
    active: boolean;
  };
}) {
  const router = useRouter();

  const [domain, setDomain] = useState(defaultValues?.domain ?? "");
  const [pattern, setPattern] = useState(defaultValues?.pattern ?? "");
  const [testEmail, setTestEmail] = useState("");
  const [autoApprove, setAutoApprove] = useState(defaultValues?.autoApprove ?? false);
  const [active, setActive] = useState(defaultValues?.active ?? true);
  const [defaultRoleId, setDefaultRoleId] = useState(defaultValues?.defaultRoleId ?? "");
  const [defaultBranchId, setDefaultBranchId] = useState(defaultValues?.defaultBranchId ?? "");

  const action = mode === "create" ? criarPoliticaEmailAction : atualizarPoliticaEmailAction;

  const [state, formAction, isPending] = useActionState<
    ActionResult<{ policyId: string }> | null,
    FormData
  >(action, null);

  // Sucesso redireciona no servidor; aqui só tratamos falha.
  useEffect(() => {
    if (state && !state.ok) {
      toast.error(state.error);
    }
  }, [state]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  const patternValid = isValidPattern(pattern);
  const patternIsEmpty = pattern.trim().length === 0;
  const testResult =
    !patternIsEmpty && patternValid && testEmail.trim().length > 0
      ? matchesEmailPattern(testEmail, pattern)
      : null;

  return (
    <form action={formAction} className="space-y-5">
      {policyId ? <input type="hidden" name="policyId" value={policyId} /> : null}

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <FormField
        id="domain"
        label="Domínio corporativo"
        required
        hint="Somente o domínio, sem @ e sem http. Ex.: exemplo.com.br"
        errors={fieldErrors["domain"]}
      >
        <Input
          id="domain"
          name="domain"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder="exemplo.com.br"
          required
        />
      </FormField>

      <div className="space-y-3 rounded-md border p-3">
        <FormField
          id="pattern"
          label="Regra por e-mail (opcional)"
          hint="Expressão regular aplicada ao e-mail completo. Em branco libera todo o domínio."
          errors={fieldErrors["pattern"]}
        >
          <Input
            id="pattern"
            name="pattern"
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            placeholder="^.+\\+filial[a-z]+@"
            className="font-mono text-sm"
          />
        </FormField>

        {!patternValid ? (
          <p className="text-destructive text-xs">
            Expressão regular inválida — ela nunca liberaria acesso, então não pode ser salva.
          </p>
        ) : null}

        {patternValid && !patternIsEmpty ? (
          <div className="space-y-1.5">
            <label htmlFor="test-email" className="text-xs font-medium">
              Testar a regra com um e-mail
            </label>
            <Input
              id="test-email"
              value={testEmail}
              onChange={(event) => setTestEmail(event.target.value)}
              placeholder={`alguem@${domain || "exemplo.com.br"}`}
              className="text-sm"
            />

            {testResult !== null ? (
              <p
                className={testResult ? "text-xs text-emerald-700" : "text-destructive text-xs"}
                role="status"
              >
                {testResult
                  ? "Esta regra autoriza o e-mail informado."
                  : "Esta regra bloqueia o e-mail informado."}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Aprovar automaticamente no primeiro login</p>
          <p className="text-muted-foreground text-xs">
            Com isso ligado, quem tiver este domínio entra já ativo, com o perfil e a unidade padrão
            abaixo. Desligado, o acesso fica pendente de aprovação.
          </p>
        </div>

        <input type="hidden" name="autoApprove" value={autoApprove ? "on" : ""} />
        <Checkbox
          checked={autoApprove}
          onCheckedChange={(value) => setAutoApprove(value === true)}
          aria-label="Aprovar automaticamente no primeiro login"
        />
      </div>

      {autoApprove ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="defaultRoleId" label="Perfil padrão" hint="Aplicado no auto-aprovar.">
            <input type="hidden" name="defaultRoleId" value={defaultRoleId} />
            <Select value={defaultRoleId} onValueChange={setDefaultRoleId}>
              <SelectTrigger id="defaultRoleId" className="w-full">
                <SelectValue placeholder="Selecione o perfil" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField id="defaultBranchId" label="Unidade padrão" hint="Aplicada no auto-aprovar.">
            <input type="hidden" name="defaultBranchId" value={defaultBranchId} />
            <Select value={defaultBranchId} onValueChange={setDefaultBranchId}>
              <SelectTrigger id="defaultBranchId" className="w-full">
                <SelectValue placeholder="Selecione a unidade" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
      ) : (
        <>
          <input type="hidden" name="defaultRoleId" value="" />
          <input type="hidden" name="defaultBranchId" value="" />
        </>
      )}

      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Política ativa</p>
          <p className="text-muted-foreground text-xs">
            Desativar bloqueia novos logins deste domínio sem apagar o histórico.
          </p>
        </div>

        <input type="hidden" name="active" value={active ? "on" : ""} />
        <Checkbox
          checked={active}
          onCheckedChange={(value) => setActive(value === true)}
          aria-label="Política ativa"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending || !patternValid}>
          {isPending ? "Salvando…" : mode === "create" ? "Criar política" : "Salvar política"}
        </Button>

        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
