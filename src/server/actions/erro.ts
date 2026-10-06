"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/server/auth/guards";
import { formDataToValues, readText } from "@/server/actions/helpers";
import { reopenErrorLog, resolveErrorLog } from "@/server/services/error-log";

/** Triagem dos erros de servidor capturados (FASE 20). */

/**
 * Marca o erro como resolvido.
 *
 * Resolver não apaga a linha: o histórico é o que permite notar que o mesmo
 * problema voltou. Some da lista de abertos e deixa de incomodar.
 */
export async function resolverErroAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("papel:manage");
    const values = formDataToValues(formData);

    const errorLogId = readText(values, "errorLogId");

    if (!errorLogId) return { ok: false, error: "Erro não informado." };

    await resolveErrorLog(errorLogId, context.user.id);

    revalidatePath("/admin/erros");
    revalidatePath("/", "layout");

    return actionSuccess(undefined, "Erro marcado como resolvido.");
  });
}

/** Reabre: o problema voltou, ou foi resolvido por engano. */
export async function reabrirErroAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    await requirePermission("papel:manage");
    const values = formDataToValues(formData);

    const errorLogId = readText(values, "errorLogId");

    if (!errorLogId) return { ok: false, error: "Erro não informado." };

    await reopenErrorLog(errorLogId);

    revalidatePath("/admin/erros");
    revalidatePath("/", "layout");

    return actionSuccess(undefined, "Erro reaberto.");
  });
}
