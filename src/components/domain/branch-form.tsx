"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ActionResult } from "@/lib/action-result";
import { cnpjLookupResponseSchema } from "@/lib/cnpj";
import { formatCnpj, onlyDigits } from "@/lib/format";
import { BRANCH_FORM_STEPS } from "@/lib/validation/branch";
import { isValidCnpj, UF_LIST } from "@/lib/validation/br";
import { cn } from "@/lib/utils";
import { atualizarFilialAction, criarFilialAction } from "@/server/actions/filial";

export type BranchFormValues = {
  id?: string;
  code: string;
  name: string;
  type: "MATRIX" | "BRANCH";
  legalName: string | null;
  tradeName: string | null;
  cnpj: string | null;
  stateRegistration: string | null;
  cnae: string | null;
  zipCode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  legalResponsibleId: string | null;
  legalResponsibleName: string | null;
  legalResponsibleDocument: string | null;
  warehouseResponsibleId: string | null;
  notificationResponsibleId: string | null;
  defaultApproverId: string | null;
  notes: string | null;
  parentId: string | null;
  active: boolean;
};

export type PeopleOption = { id: string; name: string; email: string };
export type BranchOption = { id: string; code: string; name: string };

/**
 * Formulário de unidade.
 *
 * Um único `<form>` com os três blocos do cadastro: os passos apenas alternam
 * a visibilidade, então todos os campos são enviados juntos e o usuário pode
 * voltar sem perder nada.
 */
export function BranchForm({
  mode,
  people,
  branches,
  defaultValues,
}: {
  mode: "create" | "edit";
  people: PeopleOption[];
  branches: BranchOption[];
  defaultValues?: BranchFormValues;
}) {
  const [step, setStep] = useState(0);
  const [type, setType] = useState<"MATRIX" | "BRANCH">(defaultValues?.type ?? "BRANCH");
  const [active, setActive] = useState(defaultValues?.active ?? true);
  const [state, setState] = useState<string>(defaultValues?.state ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const [cnpjLoading, setCnpjLoading] = useState(false);

  const action = mode === "create" ? criarFilialAction : atualizarFilialAction;

  const [result, formAction, isPending] = useActionState<
    ActionResult<{ branchId: string }> | null,
    FormData
  >(action, null);

  // Sucesso redireciona no servidor; aqui tratamos apenas a falha.
  useEffect(() => {
    if (result && !result.ok) {
      toast.error(result.error);
    }
  }, [result]);

  /** Escreve um valor em um campo não-controlado, pelo nome. */
  const fillField = (form: HTMLFormElement, name: string, value: string | null) => {
    if (!value) return;

    const field = form.elements.namedItem(name);

    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      field.value = value;
    }
  };

  /** Busca o CNPJ na base pública e completa os campos do cadastro. */
  const handleCnpjLookup = async () => {
    const form = formRef.current;
    if (!form) return;

    const cnpjField = form.elements.namedItem("cnpj");
    const digits = cnpjField instanceof HTMLInputElement ? onlyDigits(cnpjField.value) : "";

    if (!isValidCnpj(digits)) {
      toast.error("Informe um CNPJ válido antes de buscar.");
      return;
    }

    setCnpjLoading(true);

    try {
      const response = await fetch(`/api/cnpj/${digits}`);
      const body: unknown = await response.json();
      const parsed = cnpjLookupResponseSchema.safeParse(body);
      const data = parsed.success ? parsed.data.data : undefined;

      if (!response.ok || !parsed.success || !parsed.data.ok || !data) {
        toast.error(
          parsed.success && parsed.data.error
            ? parsed.data.error
            : "Não foi possível consultar o CNPJ agora.",
        );
        return;
      }

      fillField(form, "cnpj", formatCnpj(data.cnpj));
      fillField(form, "legalName", data.legalName);
      fillField(form, "tradeName", data.tradeName);
      fillField(form, "cnae", data.cnae);
      fillField(form, "zipCode", data.zipCode);
      fillField(form, "street", data.street);
      fillField(form, "number", data.number);
      fillField(form, "complement", data.complement);
      fillField(form, "district", data.district);
      fillField(form, "city", data.city);

      if (data.state) setState(data.state);

      toast.success("Dados do CNPJ preenchidos. Confira antes de salvar.");
    } catch {
      toast.error("Não foi possível consultar o CNPJ agora.");
    } finally {
      setCnpjLoading(false);
    }
  };

  const fieldErrors = result && !result.ok ? (result.fieldErrors ?? {}) : {};

  /** Passo que contém o primeiro campo com erro. */
  const stepWithFirstError = (value: typeof result): number | null => {
    if (!value || value.ok || !value.fieldErrors) return null;

    const keys = Object.keys(value.fieldErrors);
    const layout: Array<{ step: number; fields: string[] }> = [
      {
        step: 0,
        fields: [
          "code",
          "name",
          "type",
          "cnpj",
          "legalName",
          "tradeName",
          "stateRegistration",
          "cnae",
        ],
      },
      {
        step: 1,
        fields: [
          "zipCode",
          "street",
          "number",
          "complement",
          "district",
          "city",
          "state",
          "email",
          "phone",
          "whatsapp",
        ],
      },
      {
        step: 2,
        fields: [
          "parentId",
          "legalResponsibleName",
          "legalResponsibleDocument",
          "warehouseResponsibleId",
          "notificationResponsibleId",
          "defaultApproverId",
          "notes",
        ],
      },
    ];

    return layout.find((entry) => entry.fields.some((field) => keys.includes(field)))?.step ?? null;
  };

  // Ao receber um novo resultado com erro, salta para o passo problemático.
  // Ajustar o estado durante a renderização é o padrão recomendado pelo React
  // para estado derivado — um efeito aqui causaria render em cascata.
  const [handledResult, setHandledResult] = useState<typeof result>(null);

  if (result !== handledResult) {
    setHandledResult(result);

    const target = stepWithFirstError(result);
    if (target !== null) setStep(target);
  }

  const current = BRANCH_FORM_STEPS[step];

  return (
    <form ref={formRef} action={formAction} className="space-y-6">
      {defaultValues?.id ? <input type="hidden" name="branchId" value={defaultValues.id} /> : null}
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="active" value={active ? "on" : ""} />
      <input type="hidden" name="country" value={defaultValues?.country ?? "Brasil"} />

      {result && !result.ok ? <FormError message={result.error} /> : null}

      {/* Indicador de passos */}
      <ol className="flex flex-wrap gap-2" aria-label="Etapas do cadastro">
        {BRANCH_FORM_STEPS.map((entry, index) => (
          <li key={entry.id} className="flex-1">
            <button
              type="button"
              onClick={() => setStep(index)}
              aria-current={index === step ? "step" : undefined}
              className={cn(
                "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                index === step
                  ? "border-primary bg-accent text-accent-foreground font-medium"
                  : "hover:bg-accent/50",
              )}
            >
              <span className="block text-xs opacity-70">Passo {index + 1}</span>
              {entry.title}
            </button>
          </li>
        ))}
      </ol>

      <p className="text-muted-foreground text-sm">{current?.description}</p>

      {/* Passo 1 — Identificação */}
      <div className={cn("grid gap-4 sm:grid-cols-2", step !== 0 && "hidden")}>
        <FormField
          id="code"
          label="Código da unidade"
          required
          hint="Ex.: MATRIZ, FIL-SP-01. Não pode repetir."
          errors={fieldErrors["code"]}
        >
          <Input
            id="code"
            name="code"
            defaultValue={defaultValues?.code}
            className="uppercase"
            required
          />
        </FormField>

        <FormField id="name" label="Nome da unidade" required errors={fieldErrors["name"]}>
          <Input id="name" name="name" defaultValue={defaultValues?.name} required />
        </FormField>

        <FormField
          id="cnpj"
          label="CNPJ"
          required={mode === "create"}
          hint="Use “Buscar dados” para preencher razão social e endereço automaticamente."
          errors={fieldErrors["cnpj"]}
        >
          <div className="flex gap-2">
            <Input
              id="cnpj"
              name="cnpj"
              defaultValue={defaultValues?.cnpj ?? ""}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleCnpjLookup()}
              disabled={cnpjLoading}
              aria-busy={cnpjLoading}
            >
              {cnpjLoading ? "Buscando…" : "Buscar dados"}
            </Button>
          </div>
        </FormField>

        <FormField
          id="stateRegistration"
          label="Inscrição estadual"
          errors={fieldErrors["stateRegistration"]}
        >
          <Input
            id="stateRegistration"
            name="stateRegistration"
            defaultValue={defaultValues?.stateRegistration ?? ""}
          />
        </FormField>

        <FormField id="legalName" label="Razão social" errors={fieldErrors["legalName"]}>
          <Input id="legalName" name="legalName" defaultValue={defaultValues?.legalName ?? ""} />
        </FormField>

        <FormField id="tradeName" label="Nome fantasia" errors={fieldErrors["tradeName"]}>
          <Input id="tradeName" name="tradeName" defaultValue={defaultValues?.tradeName ?? ""} />
        </FormField>

        <FormField
          id="cnae"
          label="CNAE"
          hint="7 dígitos, sem pontuação."
          errors={fieldErrors["cnae"]}
        >
          <Input
            id="cnae"
            name="cnae"
            defaultValue={defaultValues?.cnae ?? ""}
            inputMode="numeric"
          />
        </FormField>

        <FormField
          id="type-display"
          label="Tipo de unidade"
          hint="A matriz tem visão de toda a rede."
        >
          <div className="flex gap-2">
            {(
              [
                { value: "BRANCH", label: "Unidade" },
                { value: "MATRIX", label: "Matriz" },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setType(option.value)}
                aria-pressed={type === option.value}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm transition-colors",
                  type === option.value
                    ? "border-primary bg-accent text-accent-foreground font-medium"
                    : "hover:bg-accent/50",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </FormField>
      </div>

      {/* Passo 2 — Endereço e contato */}
      <div className={cn("grid gap-4 sm:grid-cols-2", step !== 1 && "hidden")}>
        <FormField id="zipCode" label="CEP" errors={fieldErrors["zipCode"]}>
          <Input
            id="zipCode"
            name="zipCode"
            defaultValue={defaultValues?.zipCode ?? ""}
            placeholder="00000-000"
            inputMode="numeric"
          />
        </FormField>

        <FormField id="street" label="Logradouro" errors={fieldErrors["street"]}>
          <Input id="street" name="street" defaultValue={defaultValues?.street ?? ""} />
        </FormField>

        <FormField id="number" label="Número" errors={fieldErrors["number"]}>
          <Input id="number" name="number" defaultValue={defaultValues?.number ?? ""} />
        </FormField>

        <FormField id="complement" label="Complemento" errors={fieldErrors["complement"]}>
          <Input id="complement" name="complement" defaultValue={defaultValues?.complement ?? ""} />
        </FormField>

        <FormField id="district" label="Bairro" errors={fieldErrors["district"]}>
          <Input id="district" name="district" defaultValue={defaultValues?.district ?? ""} />
        </FormField>

        <FormField id="city" label="Cidade" errors={fieldErrors["city"]}>
          <Input id="city" name="city" defaultValue={defaultValues?.city ?? ""} />
        </FormField>

        <FormField id="state" label="UF" errors={fieldErrors["state"]}>
          <input type="hidden" name="state" value={state} />
          <Select value={state} onValueChange={setState}>
            <SelectTrigger id="state" className="w-full">
              <SelectValue placeholder="Selecione a UF" />
            </SelectTrigger>
            <SelectContent>
              {UF_LIST.map((uf) => (
                <SelectItem key={uf.code} value={uf.code}>
                  {uf.code} — {uf.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField id="email" label="E-mail de contato" errors={fieldErrors["email"]}>
          <Input id="email" name="email" type="email" defaultValue={defaultValues?.email ?? ""} />
        </FormField>

        <FormField id="phone" label="Telefone" errors={fieldErrors["phone"]}>
          <Input
            id="phone"
            name="phone"
            defaultValue={defaultValues?.phone ?? ""}
            placeholder="(11) 3333-4444"
          />
        </FormField>

        <FormField id="whatsapp" label="WhatsApp" errors={fieldErrors["whatsapp"]}>
          <Input
            id="whatsapp"
            name="whatsapp"
            defaultValue={defaultValues?.whatsapp ?? ""}
            placeholder="(11) 99999-8888"
          />
        </FormField>
      </div>

      {/* Passo 3 — Responsáveis e operação */}
      <div className={cn("grid gap-4 sm:grid-cols-2", step !== 2 && "hidden")}>
        <div className="sm:col-span-2">
          <FormField
            id="parentId"
            label="Unidade superior (hierarquia)"
            hint="Opcional. A unidade que responde por esta. Não pode criar ciclo."
            errors={fieldErrors["parentId"]}
          >
            <ParentBranchSelect branches={branches} defaultValue={defaultValues?.parentId} />
          </FormField>
        </div>

        <FormField
          id="legalResponsibleName"
          label="Responsável legal (nome)"
          errors={fieldErrors["legalResponsibleName"]}
        >
          <Input
            id="legalResponsibleName"
            name="legalResponsibleName"
            defaultValue={defaultValues?.legalResponsibleName ?? ""}
          />
        </FormField>

        <FormField
          id="legalResponsibleDocument"
          label="CPF do responsável legal"
          errors={fieldErrors["legalResponsibleDocument"]}
        >
          <Input
            id="legalResponsibleDocument"
            name="legalResponsibleDocument"
            defaultValue={defaultValues?.legalResponsibleDocument ?? ""}
            inputMode="numeric"
          />
        </FormField>

        <FormField
          id="warehouseResponsibleId"
          label="Responsável pelo almoxarifado"
          hint="Quem cuida fisicamente do estoque nesta unidade."
          errors={fieldErrors["warehouseResponsibleId"]}
        >
          <PersonSelect
            id="warehouseResponsibleId"
            name="warehouseResponsibleId"
            people={people}
            defaultValue={defaultValues?.warehouseResponsibleId}
          />
        </FormField>

        <FormField
          id="defaultApproverId"
          label="Aprovador padrão de solicitações"
          hint="Recebe a notificação de novas solicitações desta unidade."
          errors={fieldErrors["defaultApproverId"]}
        >
          <PersonSelect
            id="defaultApproverId"
            name="defaultApproverId"
            people={people}
            defaultValue={defaultValues?.defaultApproverId}
          />
        </FormField>

        <FormField
          id="notificationResponsibleId"
          label="Responsável por notificações"
          hint="Quem acompanha os alertas operacionais da unidade."
          errors={fieldErrors["notificationResponsibleId"]}
        >
          <PersonSelect
            id="notificationResponsibleId"
            name="notificationResponsibleId"
            people={people}
            defaultValue={defaultValues?.notificationResponsibleId}
          />
        </FormField>

        <FormField id="notes" label="Observações" errors={fieldErrors["notes"]}>
          <Textarea id="notes" name="notes" defaultValue={defaultValues?.notes ?? ""} rows={3} />
        </FormField>

        <div className="flex items-start justify-between gap-4 rounded-md border p-3 sm:col-span-2">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Unidade ativa</p>
            <p className="text-muted-foreground text-xs">
              Unidades inativas não aceitam novas solicitações nem movimentações, mas continuam
              legíveis para auditoria.
            </p>
          </div>
          <Checkbox
            checked={active}
            onCheckedChange={(value) => setActive(value === true)}
            aria-label="Unidade ativa"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {step > 0 ? (
          <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
            Voltar
          </Button>
        ) : null}

        {step < BRANCH_FORM_STEPS.length - 1 ? (
          <Button type="button" onClick={() => setStep(step + 1)}>
            Continuar
          </Button>
        ) : null}

        <Button type="submit" disabled={isPending}>
          {isPending ? "Salvando…" : mode === "create" ? "Cadastrar unidade" : "Salvar alterações"}
        </Button>

        {step < BRANCH_FORM_STEPS.length - 1 ? (
          <p className="text-muted-foreground w-full text-xs sm:w-auto sm:self-center">
            Você pode salvar direto: os outros passos são opcionais.
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** Select de pessoa com opção "nenhum". */
function PersonSelect({
  id,
  name,
  people,
  defaultValue,
}: {
  id: string;
  name: string;
  people: PeopleOption[];
  defaultValue?: string | null;
}) {
  const NONE = "__none__";
  const [value, setValue] = useState(defaultValue ?? NONE);

  return (
    <>
      {/* "nenhum" precisa virar vazio: um id literal quebraria a chave estrangeira. */}
      <input type="hidden" name={name} value={value === NONE ? "" : value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Selecione a pessoa" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Nenhum</SelectItem>
          {people.map((person) => (
            <SelectItem key={person.id} value={person.id}>
              {person.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

/** Select de unidade superior (hierarquia) com opção "nenhuma". */
function ParentBranchSelect({
  branches,
  defaultValue,
}: {
  branches: BranchOption[];
  defaultValue?: string | null;
}) {
  const NONE = "__none__";
  const [value, setValue] = useState(defaultValue ?? NONE);

  return (
    <>
      {/* "nenhuma" precisa virar vazio: um id literal quebraria a chave estrangeira. */}
      <input type="hidden" name="parentId" value={value === NONE ? "" : value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger id="parentId" className="w-full">
          <SelectValue placeholder="Nenhuma (raiz da hierarquia)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Nenhuma (raiz da hierarquia)</SelectItem>
          {branches.map((branch) => (
            <SelectItem key={branch.id} value={branch.id}>
              {branch.code} — {branch.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
