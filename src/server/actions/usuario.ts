"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { actionSuccess, runAction, type ActionResult } from "@/lib/action-result";
import {
  addMembershipSchema,
  changeUserStatusSchema,
  createUserSchema,
  removeMembershipSchema,
  updateMembershipSchema,
  updateUserSchema,
} from "@/lib/validation/user";
import { requirePermission } from "@/server/auth/guards";
import {
  formDataToValues,
  readBoolean,
  readList,
  readText,
  requestMetadata,
  validationFailure,
} from "@/server/actions/helpers";
import {
  addMembership,
  changeUserStatus,
  createUser,
  getUserDetail,
  removeMembership,
  updateMembership,
  updateUser,
} from "@/server/services/user";

/**
 * Ações de administração de usuários.
 *
 * Toda ação segue o padrão do AGENTS.md §5:
 *   Zod → permissão → filial → service → revalidate → ActionResult
 */

function revalidateUserViews(userId?: string) {
  revalidatePath("/admin/usuarios");
  if (userId) revalidatePath(`/admin/usuarios/${userId}`);
}

export async function criarUsuarioAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ userId: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("usuario:manage");
    const values = formDataToValues(formData);

    const parsed = createUserSchema.safeParse({
      name: readText(values, "name"),
      email: readText(values, "email"),
      roleId: readText(values, "roleId"),
      branchIds: readList(values, "branchIds"),
      sectorId: readText(values, "sectorId"),
      activateNow: readBoolean(values, "activateNow"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const created = await createUser(context, parsed.data, metadata);

    revalidateUserViews(created.userId);

    return actionSuccess({ userId: created.userId });
  });

  // Em caso de sucesso navegamos do servidor: `router.push` no cliente logo
  // após uma Server Action é frágil (a transição ainda está em curso).
  if (result.ok) {
    redirect(`/admin/usuarios/${result.data.userId}?criado=1`);
  }

  return result;
}

export async function atualizarUsuarioAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ userId: string }>> {
  return runAction(async () => {
    const context = await requirePermission("usuario:manage");
    const values = formDataToValues(formData);

    const parsed = updateUserSchema.safeParse({
      userId: readText(values, "userId"),
      name: readText(values, "name"),
      active: readBoolean(values, "active"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await updateUser(context, parsed.data, metadata);

    revalidateUserViews(parsed.data.userId);

    return actionSuccess({ userId: parsed.data.userId }, "Dados atualizados.");
  });
}

export async function alterarStatusUsuarioAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ userId: string }>> {
  return runAction(async () => {
    const context = await requirePermission("usuario:manage");
    const values = formDataToValues(formData);

    const parsed = changeUserStatusSchema.safeParse({
      userId: readText(values, "userId"),
      status: readText(values, "status"),
      reason: readText(values, "reason"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await changeUserStatus(context, parsed.data, metadata);

    revalidateUserViews(parsed.data.userId);

    const labels: Record<string, string> = {
      ACTIVE: "Acesso ativado.",
      PENDING: "Acesso marcado como pendente.",
      SUSPENDED: "Acesso suspenso.",
      INACTIVE: "Conta inativada.",
    };

    return actionSuccess(
      { userId: parsed.data.userId },
      labels[parsed.data.status] ?? "Status atualizado.",
    );
  });
}

export async function adicionarVinculoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ membershipId: string }>> {
  return runAction(async () => {
    const context = await requirePermission("usuario:manage");
    const values = formDataToValues(formData);

    const parsed = addMembershipSchema.safeParse({
      userId: readText(values, "userId"),
      branchId: readText(values, "branchId"),
      roleId: readText(values, "roleId"),
      sectorId: readText(values, "sectorId"),
      isDefault: readBoolean(values, "isDefault"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const membership = await addMembership(context, parsed.data, metadata);

    revalidateUserViews(parsed.data.userId);

    return actionSuccess({ membershipId: membership.id }, "Vínculo adicionado.");
  });
}

export async function editarVinculoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ membershipId: string }>> {
  return runAction(async () => {
    const context = await requirePermission("usuario:manage");
    const values = formDataToValues(formData);

    const parsed = updateMembershipSchema.safeParse({
      membershipId: readText(values, "membershipId"),
      roleId: readText(values, "roleId"),
      sectorId: readText(values, "sectorId"),
      isDefault: readBoolean(values, "isDefault"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const userId = readText(values, "userId");
    const metadata = await requestMetadata();

    await updateMembership(context, parsed.data, metadata);

    revalidateUserViews(userId);

    return actionSuccess({ membershipId: parsed.data.membershipId }, "Vínculo atualizado.");
  });
}

export async function removerVinculoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("usuario:manage");
    const values = formDataToValues(formData);

    const parsed = removeMembershipSchema.safeParse({
      membershipId: readText(values, "membershipId"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const userId = readText(values, "userId");
    const metadata = await requestMetadata();

    await removeMembership(context, parsed.data.membershipId, metadata);

    revalidateUserViews(userId);

    return actionSuccess(undefined, "Vínculo removido.");
  });
}

/** Ação de leitura usada pelo formulário para pré-visualizar o usuário. */
export async function buscarUsuarioAction(userId: string) {
  const context = await requirePermission("usuario:read");

  return getUserDetail(context, userId);
}
