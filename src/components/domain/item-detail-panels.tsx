"use client";

import { Plus } from "lucide-react";
import { useActionState, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { FormError, FormField } from "@/components/domain/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action-result";
import { formatDate, formatQuantity } from "@/lib/format";
import {
  criarLoteAction,
  definirPoliticaEstoqueAction,
  desativarLoteAction,
  removerPoliticaEstoqueAction,
} from "@/server/actions/item";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Lotes                                                                       */
/* -------------------------------------------------------------------------- */

export type LotRow = {
  id: string;
  code: string;
  expirationDate: Date | null;
  active: boolean;
};

export function LotManager({
  itemId,
  controlledByLot,
  lots,
  canManage,
}: {
  itemId: string;
  controlledByLot: boolean;
  lots: LotRow[];
  canManage: boolean;
}) {
  const [creating, setCreating] = useState(false);

  const [state, action, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    desativarLoteAction,
    null,
  );

  useEffect(() => {
    if (!state) return;

    if (state.ok) toast.success(state.message ?? "Lote desativado.");
    else toast.error(state.error);
  }, [state]);

  if (!controlledByLot) {
    return (
      <p className="text-muted-foreground text-sm">
        Este material não é controlado por lote. Marque a opção <strong>Controle por lote</strong>{" "}
        na aba de dados para habilitar lotes e validade.
      </p>
    );
  }

  const now = new Date();

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-md border">
        {lots.length === 0 ? (
          <li className="text-muted-foreground p-3 text-sm">
            Nenhum lote cadastrado. Sem lote, este material não pode receber entrada.
          </li>
        ) : (
          lots.map((lot) => {
            const expired = lot.expirationDate !== null && lot.expirationDate < now;
            const expiringSoon =
              lot.expirationDate !== null &&
              !expired &&
              lot.expirationDate.getTime() - now.getTime() < 30 * 24 * 60 * 60 * 1000;

            return (
              <li
                key={lot.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {lot.code}
                    {!lot.active ? (
                      <Badge variant="outline" className="ml-2">
                        inativo
                      </Badge>
                    ) : null}
                    {expired ? (
                      <Badge variant="outline" className="text-destructive ml-2 border-red-300">
                        vencido
                      </Badge>
                    ) : expiringSoon ? (
                      <Badge variant="outline" className="ml-2 border-amber-300 text-amber-700">
                        vence em breve
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {lot.expirationDate
                      ? `Validade ${formatDate(lot.expirationDate)}`
                      : "Sem validade"}
                  </p>
                </div>

                {canManage && lot.active ? (
                  <form action={action}>
                    <input type="hidden" name="lotId" value={lot.id} />
                    <input type="hidden" name="itemId" value={itemId} />
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
              </li>
            );
          })
        )}
      </ul>

      {canManage ? (
        creating ? (
          <LotForm itemId={itemId} onDone={() => setCreating(false)} />
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Novo lote
          </Button>
        )
      ) : null}
    </div>
  );
}

function LotForm({ itemId, onDone }: { itemId: string; onDone: () => void }) {
  const [active, setActive] = useState(true);

  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    criarLoteAction,
    null,
  );

  useEffect(() => {
    if (!state) return;

    if (state.ok) {
      toast.success(state.message ?? "Lote cadastrado.");
      onDone();
    } else {
      toast.error(state.error);
    }
  }, [state, onDone]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="space-y-3 rounded-md border p-3">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="active" value={active ? "on" : ""} />

      <p className="text-sm font-medium">Novo lote</p>

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="lot-code" label="Código do lote" required errors={fieldErrors["code"]}>
          <Input id="lot-code" name="code" required />
        </FormField>

        <FormField
          id="lot-expiration"
          label="Validade"
          hint="Deixe vazio para material sem validade."
          errors={fieldErrors["expirationDate"]}
        >
          <Input id="lot-expiration" name="expirationDate" type="date" />
        </FormField>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox checked={active} onCheckedChange={(value) => setActive(value === true)} />
        Lote ativo
      </label>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Salvando…" : "Cadastrar lote"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Política de estoque por unidade                                             */
/* -------------------------------------------------------------------------- */

export type PolicyRow = {
  id: string;
  branchName: string;
  branchCode: string;
  minimumQuantity: string;
  maximumQuantity: string | null;
};

export type BranchCheckOption = { id: string; code: string; name: string };

export function StockPolicyManager({
  itemId,
  policies,
  branches,
  unitCode,
  canManage,
}: {
  itemId: string;
  policies: PolicyRow[];
  branches: BranchCheckOption[];
  unitCode: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);

  const close = useCallback(() => {
    setOpen(false);
    setSelectedBranches([]);
  }, []);

  const [removeState, removeAction, isRemoving] = useActionState<
    ActionResult<unknown> | null,
    FormData
  >(removerPoliticaEstoqueAction, null);

  useEffect(() => {
    if (!removeState) return;

    if (removeState.ok) toast.success(removeState.message ?? "Mínimo removido.");
    else toast.error(removeState.error);
  }, [removeState]);

  const toggleBranch = (branchId: string) => {
    setSelectedBranches((current) =>
      current.includes(branchId) ? current.filter((id) => id !== branchId) : [...current, branchId],
    );
  };

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-md border">
        {policies.length === 0 ? (
          <li className="text-muted-foreground p-3 text-sm">
            Nenhum mínimo definido. Sem mínimo, o sistema não avisa quando o estoque acaba.
          </li>
        ) : (
          policies.map((policy) => (
            <li
              key={policy.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {policy.branchName}
                  <span className="text-muted-foreground ml-2 font-mono text-xs">
                    {policy.branchCode}
                  </span>
                </p>
                <p className="text-muted-foreground text-xs">
                  Mínimo {formatQuantity(policy.minimumQuantity)} {unitCode}
                  {policy.maximumQuantity
                    ? ` · máximo ${formatQuantity(policy.maximumQuantity)} ${unitCode}`
                    : ""}
                </p>
              </div>

              {canManage ? (
                <form action={removeAction}>
                  <input type="hidden" name="policyId" value={policy.id} />
                  <input type="hidden" name="itemId" value={itemId} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    disabled={isRemoving}
                  >
                    Remover
                  </Button>
                </form>
              ) : null}
            </li>
          ))
        )}
      </ul>

      {canManage ? (
        open ? (
          <StockPolicyForm
            itemId={itemId}
            branches={branches}
            unitCode={unitCode}
            selectedBranches={selectedBranches}
            toggleBranch={toggleBranch}
            onDone={close}
          />
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            Definir mínimo
          </Button>
        )
      ) : null}
    </div>
  );
}

function StockPolicyForm({
  itemId,
  branches,
  unitCode,
  selectedBranches,
  toggleBranch,
  onDone,
}: {
  itemId: string;
  branches: BranchCheckOption[];
  unitCode: string;
  selectedBranches: string[];
  toggleBranch: (branchId: string) => void;
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState<ActionResult<unknown> | null, FormData>(
    definirPoliticaEstoqueAction,
    null,
  );

  useEffect(() => {
    if (!state) return;

    if (state.ok) {
      toast.success(state.message ?? "Mínimo definido.");
      onDone();
    } else {
      toast.error(state.error);
    }
  }, [state, onDone]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="space-y-3 rounded-md border p-3">
      <input type="hidden" name="itemId" value={itemId} />

      <p className="text-sm font-medium">Definir mínimo</p>

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <fieldset className="space-y-2">
        <legend className="text-sm">Unidades</legend>
        <p className="text-muted-foreground text-xs">
          Um mesmo material pode ter mínimos diferentes em cada unidade.
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          {branches.map((branch) => (
            <label
              key={branch.id}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm",
                selectedBranches.includes(branch.id) ? "border-primary" : "",
              )}
            >
              <Checkbox
                name="branchIds"
                value={branch.id}
                checked={selectedBranches.includes(branch.id)}
                onCheckedChange={() => toggleBranch(branch.id)}
              />
              <span className="min-w-0">
                <span className="block truncate">{branch.name}</span>
                <span className="text-muted-foreground text-xs">{branch.code}</span>
              </span>
            </label>
          ))}
        </div>

        {fieldErrors["branchIds"] ? (
          <p role="alert" className="text-destructive text-xs">
            {fieldErrors["branchIds"].join(" ")}
          </p>
        ) : null}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <FormField
          id="policy-minimum"
          label={`Mínimo (${unitCode})`}
          errors={fieldErrors["minimumQuantity"]}
        >
          <Input
            id="policy-minimum"
            name="minimumQuantity"
            type="number"
            step="0.0001"
            min="0"
            defaultValue="0"
          />
        </FormField>

        <FormField
          id="policy-maximum"
          label={`Máximo (${unitCode})`}
          errors={fieldErrors["maximumQuantity"]}
        >
          <Input id="policy-maximum" name="maximumQuantity" type="number" step="0.0001" min="0" />
        </FormField>

        <FormField
          id="policy-alert"
          label={`Alerta (${unitCode})`}
          hint="Avisa antes de chegar no mínimo."
          errors={fieldErrors["alertQuantity"]}
        >
          <Input id="policy-alert" name="alertQuantity" type="number" step="0.0001" min="0" />
        </FormField>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Salvando…" : "Definir mínimo"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={isPending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
