"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { actionSuccess, type ActionResult } from "@/lib/action-result";
import { runAction } from "@/server/actions/run";
import { emailPolicySchema, updateEmailPolicySchema } from "@/lib/validation/user";
import { requirePermission } from "@/server/auth/guards";
import {
  formDataToValues,
  readBoolean,
  readText,
  requestMetadata,
  validationFailure,
} from "@/server/actions/helpers";
import {
  createEmailPolicy,
  toggleEmailPolicy,
  updateEmailPolicy,
} from "@/server/services/email-policy";

/** Ações de administração das políticas de e-mail (só `politica-email:manage`). */

function readPolicyForm(formData: FormData) {
  const values = formDataToValues(formData);

  return {
    domain: readText(values, "domain"),
    pattern: readText(values, "pattern"),
    autoApprove: readBoolean(values, "autoApprove"),
    defaultRoleId: readText(values, "defaultRoleId"),
    defaultBranchId: readText(values, "defaultBranchId"),
    active: readBoolean(values, "active"),
  };
}

export async function criarPoliticaEmailAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ policyId: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("politica-email:manage");

    const parsed = emailPolicySchema.safeParse(readPolicyForm(formData));

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const policy = await createEmailPolicy(context, parsed.data, metadata);

    revalidatePath("/admin/politicas-email");

    return actionSuccess({ policyId: policy.id });
  });

  if (result.ok) {
    redirect("/admin/politicas-email?criada=1");
  }

  return result;
}

export async function atualizarPoliticaEmailAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ policyId: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("politica-email:manage");

    const values = formDataToValues(formData);
    const parsed = updateEmailPolicySchema.safeParse({
      policyId: readText(values, "policyId"),
      ...readPolicyForm(formData),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const { policyId, ...input } = parsed.data;
    const metadata = await requestMetadata();

    await updateEmailPolicy(context, policyId, input, metadata);

    revalidatePath("/admin/politicas-email");

    return actionSuccess({ policyId });
  });

  if (result.ok) {
    redirect("/admin/politicas-email?salva=1");
  }

  return result;
}

export async function alternarPoliticaEmailAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ policyId: string; active: boolean }>> {
  return runAction(async () => {
    const context = await requirePermission("politica-email:manage");

    const values = formDataToValues(formData);
    const policyId = readText(values, "policyId");
    const active = readBoolean(values, "active");

    if (!policyId) {
      return { ok: false, error: "Política não informada." };
    }

    const metadata = await requestMetadata();
    const policy = await toggleEmailPolicy(context, policyId, active, metadata);

    revalidatePath("/admin/politicas-email");

    return actionSuccess(
      { policyId: policy.id, active: policy.active },
      policy.active ? "Política ativada." : "Política desativada.",
    );
  });
}
