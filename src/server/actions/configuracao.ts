"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, type ActionResult } from "@/lib/action-result";
import { runAction } from "@/server/actions/run";
import { requirePermission } from "@/server/auth/guards";
import {
  formDataToValues,
  readText,
  requestMetadata,
  validationFailure,
} from "@/server/actions/helpers";
import { CONFIG_DEFINITIONS, configValueSchema, updateConfigs } from "@/server/services/config";

/** Configurações do sistema (FASE 13). */

export async function salvarConfiguracoesAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ updated: number }>> {
  return runAction(async () => {
    const context = await requirePermission("configuracao:manage");
    const values = formDataToValues(formData);

    const raw = Object.fromEntries(
      CONFIG_DEFINITIONS.map((definition) => [
        definition.key,
        readText(values, definition.key) ?? "",
      ]),
    );

    const parsed = configValueSchema.safeParse(raw);

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const result = await updateConfigs(context, parsed.data, metadata);

    revalidatePath("/admin/configuracoes");
    revalidatePath("/", "layout");

    return actionSuccess(result, "Configurações salvas. Já valem para os próximos acessos.");
  });
}
