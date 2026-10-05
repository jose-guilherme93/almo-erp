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
import {
  adicionarVinculoAction,
  alterarStatusUsuarioAction,
  atualizarUsuarioAction,
  editarVinculoAction,
  removerVinculoAction,
} from "@/server/actions/usuario";

type PanelOption = { id: string; name: string; code?: string; scope?: string };

/* -------------------------------------------------------------------------- */
/* Dados básicos                                                              */
/* -------------------------------------------------------------------------- */

export function UserDetailsForm({
  userId,
  name,
  active,
}: {
  userId: string;
  name: string;
  active: boolean;
}) {
  const router = useRouter();
  const [isActive, setIsActive] = useState(active);

  const [state, formAction, isPending] = useActionState<
    ActionResult<{ userId: string }> | null,
    FormData
  >(atualizarUsuarioAction, null);

  useEffect(() => {
    if (!state) return;

    if (state.ok) {
      toast.success(state.message ?? "Dados atualizados.");
      router.refresh();
    } else {
      toast.error(state.error);
    }
  }, [state, router]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />

      {state && !state.ok ? <FormError message={state.error} /> : null}

      <FormField id="name" label="Nome completo" required errors={fieldErrors["name"]}>
        <Input id="name" name="name" defaultValue={name} required />
      </FormField>

      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Conta habilitada</p>
          <p className="text-muted-foreground text-xs">
            Desabilitar bloqueia o acesso sem alterar o status de aprovação.
          </p>
        </div>

        <Checkbox
          name="active"
          checked={isActive}
          onCheckedChange={(value) => setIsActive(value === true)}
          aria-label="Conta habilitada"
        />
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Salvando…" : "Salvar alterações"}
      </Button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Status de acesso                                                            */
/* -------------------------------------------------------------------------- */

const STATUS_ACTIONS = [
  { status: "ACTIVE", label: "Aprovar acesso", variant: "default" as const },
  { status: "SUSPENDED", label: "Suspender", variant: "outline" as const },
  { status: "INACTIVE", label: "Inativar", variant: "outline" as const },
];

export function UserStatusActions({ userId, status }: { userId: string; status: string }) {
  const router = useRouter();

  const [state, formAction, isPending] = useActionState<
    ActionResult<{ userId: string }> | null,
    FormData
  >(alterarStatusUsuarioAction, null);

  useEffect(() => {
    if (!state) return;

    if (state.ok) {
      toast.success(state.message ?? "Status atualizado.");
      router.refresh();
    } else {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <div className="space-y-3">
      {state && !state.ok ? <FormError message={state.error} /> : null}

      <div className="flex flex-wrap gap-2">
        {STATUS_ACTIONS.filter((action) => action.status !== status).map((action) => (
          <form key={action.status} action={formAction}>
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="status" value={action.status} />
            <Button type="submit" variant={action.variant} size="sm" disabled={isPending}>
              {action.label}
            </Button>
          </form>
        ))}
      </div>

      <p className="text-muted-foreground text-xs">
        Suspender ou inativar derruba o acesso na próxima requisição do usuário.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Vínculos                                                                    */
/* -------------------------------------------------------------------------- */

export type MembershipItem = {
  id: string;
  active: boolean;
  isDefault: boolean;
  branchId: string;
  branchName: string;
  branchCode: string;
  roleId: string;
  roleName: string;
  sectorId: string | null;
  sectorName: string | null;
};

export function MembershipManager({
  userId,
  memberships,
  branches,
  roles,
  sectors,
  canManage,
}: {
  userId: string;
  memberships: MembershipItem[];
  branches: PanelOption[];
  roles: PanelOption[];
  sectors: PanelOption[];
  canManage: boolean;
}) {
  const router = useRouter();

  const [addState, addAction, isAdding] = useActionState<
    ActionResult<{ membershipId: string }> | null,
    FormData
  >(adicionarVinculoAction, null);

  const [removeState, removeAction, isRemoving] = useActionState<
    ActionResult<undefined> | null,
    FormData
  >(removerVinculoAction, null);

  const [editState, editAction, isEditing] = useActionState<
    ActionResult<{ membershipId: string }> | null,
    FormData
  >(editarVinculoAction, null);

  useEffect(() => {
    if (!addState) return;

    if (addState.ok) {
      toast.success(addState.message ?? "Vínculo adicionado.");
      router.refresh();
    } else {
      toast.error(addState.error);
    }
  }, [addState, router]);

  useEffect(() => {
    if (!removeState) return;

    if (removeState.ok) {
      toast.success(removeState.message ?? "Vínculo removido.");
      router.refresh();
    } else {
      toast.error(removeState.error);
    }
  }, [removeState, router]);

  useEffect(() => {
    if (!editState) return;

    if (editState.ok) {
      toast.success(editState.message ?? "Vínculo atualizado.");
      router.refresh();
    } else {
      toast.error(editState.error);
    }
  }, [editState, router]);

  // Trocar a `key` do formulário o remonta após um cadastro bem-sucedido,
  // limpando os selects sem precisar de setState dentro de um efeito.
  const addFormKey = addState?.ok ? addState.data.membershipId : "novo-vinculo";

  const addFieldErrors = addState && !addState.ok ? (addState.fieldErrors ?? {}) : {};

  return (
    <div className="space-y-5">
      {editState && !editState.ok ? <FormError message={editState.error} /> : null}

      <ul className="divide-y rounded-md border">
        {memberships.length === 0 ? (
          <li className="text-muted-foreground p-3 text-sm">
            Sem vínculo. O usuário não consegue operar em nenhuma unidade.
          </li>
        ) : (
          memberships.map((membership) =>
            canManage ? (
              <MembershipRow
                key={membership.id}
                userId={userId}
                membership={membership}
                roles={roles}
                sectors={sectors}
                editAction={editAction}
                removeAction={removeAction}
                isEditing={isEditing}
                isRemoving={isRemoving}
              />
            ) : (
              <li key={membership.id} className="p-3 text-sm">
                <p className="truncate font-medium">
                  {membership.branchName}
                  {membership.isDefault ? (
                    <span className="text-muted-foreground ml-2 text-xs">(padrão)</span>
                  ) : null}
                  {!membership.active ? (
                    <span className="ml-2 text-xs text-amber-600">inativo</span>
                  ) : null}
                </p>
                <p className="text-muted-foreground text-xs">
                  {membership.branchCode} · {membership.roleName}
                  {membership.sectorName ? ` · ${membership.sectorName}` : ""}
                </p>
              </li>
            ),
          )
        )}
      </ul>

      {canManage ? (
        <AddMembershipForm
          key={addFormKey}
          userId={userId}
          branches={branches}
          roles={roles}
          sectors={sectors}
          action={addAction}
          isPending={isAdding}
          error={addState && !addState.ok ? addState.error : null}
          fieldErrors={addFieldErrors}
        />
      ) : null}
    </div>
  );
}

function MembershipRow({
  userId,
  membership,
  roles,
  sectors,
  editAction,
  removeAction,
  isEditing,
  isRemoving,
}: {
  userId: string;
  membership: MembershipItem;
  roles: PanelOption[];
  sectors: PanelOption[];
  editAction: (formData: FormData) => void;
  removeAction: (formData: FormData) => void;
  isEditing: boolean;
  isRemoving: boolean;
}) {
  const [roleId, setRoleId] = useState(membership.roleId);
  const [sectorId, setSectorId] = useState(membership.sectorId ?? "");
  const [isDefault, setIsDefault] = useState(membership.isDefault);

  return (
    <li className="space-y-2 p-3">
      <form
        action={editAction}
        className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-end"
      >
        <input type="hidden" name="membershipId" value={membership.id} />
        <input type="hidden" name="userId" value={userId} />

        <div className="min-w-0">
          <p className="truncate font-medium">
            {membership.branchName}
            {membership.isDefault ? (
              <span className="text-muted-foreground ml-2 text-xs">(padrão)</span>
            ) : null}
            {!membership.active ? (
              <span className="ml-2 text-xs text-amber-600">inativo</span>
            ) : null}
          </p>
          <p className="text-muted-foreground text-xs">
            {membership.branchCode} · {membership.roleName}
            {membership.sectorName ? ` · ${membership.sectorName}` : ""}
          </p>
        </div>

        <FormField id={`role-${membership.id}`} label="Perfil">
          {/* Input espelho: o Select do Radix não participa do FormData nativo. */}
          <input type="hidden" name="roleId" value={roleId} />
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger id={`role-${membership.id}`} className="w-full">
              <SelectValue />
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

        <FormField id={`sector-${membership.id}`} label="Setor">
          <input type="hidden" name="sectorId" value={sectorId} />
          <Select value={sectorId} onValueChange={setSectorId}>
            <SelectTrigger id={`sector-${membership.id}`} className="w-full">
              <SelectValue placeholder="Sem setor" />
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

        <div className="flex flex-wrap items-center gap-2 pb-1">
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={isDefault}
              onCheckedChange={(value) => setIsDefault(value === true)}
              aria-label="Definir como unidade padrão no login"
            />
            Padrão
          </label>
          <input type="hidden" name="isDefault" value={isDefault ? "on" : ""} />
          <Button type="submit" size="sm" variant="outline" disabled={isEditing}>
            Salvar
          </Button>
        </div>
      </form>

      <form action={removeAction}>
        <input type="hidden" name="membershipId" value={membership.id} />
        <input type="hidden" name="userId" value={userId} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={isRemoving}
          className="text-destructive"
        >
          Remover vínculo
        </Button>
      </form>
    </li>
  );
}

function AddMembershipForm({
  userId,
  branches,
  roles,
  sectors,
  action,
  isPending,
  error,
  fieldErrors,
}: {
  userId: string;
  branches: PanelOption[];
  roles: PanelOption[];
  sectors: PanelOption[];
  action: (formData: FormData) => void;
  isPending: boolean;
  error: string | null;
  fieldErrors: Record<string, string[]>;
}) {
  const [branchId, setBranchId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  return (
    <form action={action} className="space-y-3 rounded-md border p-3">
      <input type="hidden" name="userId" value={userId} />
      <p className="text-sm font-medium">Adicionar vínculo</p>

      {error ? <FormError message={error} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="branchId" label="Unidade" required errors={fieldErrors["branchId"]}>
          <input type="hidden" name="branchId" value={branchId} />
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger id="branchId" className="w-full">
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

        <FormField id="newRoleId" label="Perfil" required errors={fieldErrors["roleId"]}>
          <input type="hidden" name="roleId" value={roleId} />
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger id="newRoleId" className="w-full">
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
          id="newSectorId"
          label="Setor"
          errors={fieldErrors["sectorId"]}
          hint="Roteia chamados de atendimento (ex.: TI)."
        >
          <input type="hidden" name="sectorId" value={sectorId} />
          <Select value={sectorId} onValueChange={setSectorId}>
            <SelectTrigger id="newSectorId" className="w-full">
              <SelectValue placeholder="Sem setor" />
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

      <input type="hidden" name="isDefault" value={isDefault ? "on" : ""} />

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox checked={isDefault} onCheckedChange={(value) => setIsDefault(value === true)} />
        Definir como unidade padrão no login
      </label>

      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Adicionando…" : "Adicionar vínculo"}
      </Button>
    </form>
  );
}
