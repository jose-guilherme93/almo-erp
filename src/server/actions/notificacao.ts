"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/server/auth/guards";
import { formDataToValues, readText } from "@/server/actions/helpers";
import { markAllAsRead, markAsRead } from "@/server/services/notification/inbox";

/** Ações da caixa de notificações — sempre restritas ao próprio usuário. */

export async function marcarNotificacaoLidaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("notificacao:read");
    const notificationId = readText(formDataToValues(formData), "notificationId");

    if (!notificationId) return { ok: false, error: "Notificação não informada." };

    // `markAsRead` filtra por `userId`: ninguém marca notificação de outro.
    await markAsRead(context.user.id, notificationId);

    revalidatePath("/notificacoes");
    revalidatePath("/", "layout");

    return actionSuccess(undefined);
  });
}

export async function marcarTodasNotificacoesLidasAction(
  // Assinatura exigida pelo `useActionState`; esta ação não usa dado anterior.
  _previous: ActionResult<unknown> | null,
): Promise<ActionResult<{ count: number }>> {
  void _previous;

  return runAction(async () => {
    const context = await requirePermission("notificacao:read");

    const count = await markAllAsRead(context.user.id);

    revalidatePath("/notificacoes");
    revalidatePath("/", "layout");

    return actionSuccess({ count }, "Todas as notificações foram marcadas como lidas.");
  });
}
