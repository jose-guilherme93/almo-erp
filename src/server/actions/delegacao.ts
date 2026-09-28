"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, runAction, type ActionResult } from "@/lib/action-result";
import { requireAnyPermission } from "@/server/auth/guards";
import {
  formDataToValues,
  readText,
  requestMetadata,
  validationFailure,
} from "@/server/actions/helpers";
import {
  delegationCompleteSchema,
  delegationCreateSchema,
  delegationIdSchema,
  delegationProgressSchema,
  delegationReturnSchema,
} from "@/lib/validation/delegation";
import {
  acceptDelegation,
  cancelDelegation,
  completeDelegation,
  createDelegation,
  returnDelegation,
  updateDelegationProgress,
} from "@/server/services/delegation";

/** Ações de encaminhamento de etapa entre setores. */

function revalidateDelegationViews(entityId?: string) {
  revalidatePath("/encaminhamentos");
  revalidatePath("/meu");
  revalidatePath("/notificacoes");

  if (entityId) {
    revalidatePath(`/solicitacoes/${entityId}`);
    revalidatePath(`/reparos/${entityId}`);
  }
}

export async function encaminharEtapaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ delegationId: string }>> {
  return runAction(async () => {
    const context = await requireAnyPermission(["manutencao:delegar", "manutencao:atender"]);
    const values = formDataToValues(formData);

    const parsed = delegationCreateSchema.safeParse({
      entityType: readText(values, "entityType"),
      entityId: readText(values, "entityId"),
      toSectorId: readText(values, "toSectorId"),
      reason: readText(values, "reason"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const result = await createDelegation(context, parsed.data, metadata);

    revalidateDelegationViews(parsed.data.entityId);

    return actionSuccess(result, "Etapa encaminhada. O setor de destino foi avisado.");
  });
}

export async function assumirEtapaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const context = await requireAnyPermission(["manutencao:atender", "manutencao:delegar"]);

    const parsed = delegationIdSchema.safeParse({
      delegationId: readText(formDataToValues(formData), "delegationId"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const result = await acceptDelegation(context, parsed.data.delegationId, metadata);

    revalidateDelegationViews();

    return actionSuccess(result, "Etapa assumida pelo seu setor.");
  });
}

export async function registrarAndamentoEtapaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const context = await requireAnyPermission(["manutencao:atender", "manutencao:delegar"]);
    const values = formDataToValues(formData);

    const parsed = delegationProgressSchema.safeParse({
      delegationId: readText(values, "delegationId"),
      comment: readText(values, "comment"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await updateDelegationProgress(context, parsed.data, metadata);

    revalidateDelegationViews();

    return actionSuccess(undefined, "Andamento registrado.");
  });
}

export async function concluirEtapaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const context = await requireAnyPermission(["manutencao:atender", "manutencao:delegar"]);
    const values = formDataToValues(formData);

    const parsed = delegationCompleteSchema.safeParse({
      delegationId: readText(values, "delegationId"),
      report: readText(values, "report"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await completeDelegation(context, parsed.data, metadata);

    revalidateDelegationViews();

    return actionSuccess(undefined, "Etapa concluída com laudo. O setor de origem foi avisado.");
  });
}

export async function devolverEtapaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const context = await requireAnyPermission(["manutencao:atender", "manutencao:delegar"]);
    const values = formDataToValues(formData);

    const parsed = delegationReturnSchema.safeParse({
      delegationId: readText(values, "delegationId"),
      comment: readText(values, "comment"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await returnDelegation(context, parsed.data, metadata);

    revalidateDelegationViews();

    return actionSuccess(undefined, "Etapa encerrada no seu setor.");
  });
}

export async function cancelarEtapaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const context = await requireAnyPermission(["manutencao:delegar", "manutencao:atender"]);
    const values = formDataToValues(formData);

    const parsed = delegationReturnSchema.safeParse({
      delegationId: readText(values, "delegationId"),
      comment: readText(values, "comment"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await cancelDelegation(
      context,
      { delegationId: parsed.data.delegationId, reason: parsed.data.comment },
      metadata,
    );

    revalidateDelegationViews();

    return actionSuccess(undefined, "Encaminhamento cancelado.");
  });
}
