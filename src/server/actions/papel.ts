"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { actionSuccess, runAction, type ActionResult } from "@/lib/action-result";
import { createRoleSchema, updateRoleSchema } from "@/lib/validation/user";
import { requirePermission } from "@/server/auth/guards";
import {
  formDataToValues,
  readList,
  readText,
  requestMetadata,
  validationFailure,
} from "@/server/actions/helpers";
import { createRole, deactivateRole, updateRole } from "@/server/services/role";

/** Ações de administração de papéis (só SUPER_ADMIN, via `papel:manage`). */

export async function criarPapelAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ roleId: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("papel:manage");
    const values = formDataToValues(formData);

    const parsed = createRoleSchema.safeParse({
      name: readText(values, "name"),
      description: readText(values, "description"),
      scope: readText(values, "scope"),
      permissions: readList(values, "permissions"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const role = await createRole(context, parsed.data, metadata);

    revalidatePath("/admin/papeis");

    return actionSuccess({ roleId: role.id });
  });

  if (result.ok) {
    redirect(`/admin/papeis/${result.data.roleId}?criado=1`);
  }

  return result;
}

export async function atualizarPapelAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ roleId: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("papel:manage");
    const values = formDataToValues(formData);

    const parsed = updateRoleSchema.safeParse({
      roleId: readText(values, "roleId"),
      name: readText(values, "name"),
      description: readText(values, "description"),
      scope: readText(values, "scope"),
      permissions: readList(values, "permissions"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await updateRole(context, parsed.data, metadata);

    revalidatePath("/admin/papeis");
    revalidatePath(`/admin/papeis/${parsed.data.roleId}`);

    return actionSuccess({ roleId: parsed.data.roleId });
  });

  if (result.ok) {
    redirect(`/admin/papeis/${result.data.roleId}?salvo=1`);
  }

  return result;
}

export async function desativarPapelAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("papel:manage");
    const values = formDataToValues(formData);

    const roleId = readText(values, "roleId");

    if (!roleId) {
      return { ok: false, error: "Perfil não informado." };
    }

    const metadata = await requestMetadata();
    await deactivateRole(context, roleId, metadata);

    revalidatePath("/admin/papeis");

    return actionSuccess(undefined, "Perfil desativado.");
  });
}
