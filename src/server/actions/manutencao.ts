"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { actionSuccess, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/server/auth/guards";
import {
  formDataToValues,
  readFiles,
  readText,
  requestMetadata,
  validationFailure,
} from "@/server/actions/helpers";
import { discardStoredImages, storeUploadedImages } from "@/server/services/attachment";
import {
  assignMaintenanceSchema,
  maintenanceCompleteSchema,
  maintenanceCreateSchema,
  maintenancePrioritySchema,
  maintenanceProgressSchema,
  maintenanceRejectSchema,
} from "@/lib/validation/maintenance";
import {
  assignMaintenanceRequest,
  cancelMaintenanceRequest,
  claimMaintenanceRequest,
  completeMaintenanceRequest,
  createMaintenanceRequest,
  listMaintenanceAssignees,
  listRequestableBranchesForMaintenance,
  rejectMaintenanceRequest,
  setMaintenancePriority,
  updateMaintenanceProgress,
} from "@/server/services/maintenance";

/** Ações do chamado de reparo. */

function revalidateMaintenance(requestId?: string) {
  revalidatePath("/reparos");
  revalidatePath("/solicitar");
  revalidatePath("/meu");
  revalidatePath("/dashboard");
  revalidatePath("/notificacoes");

  if (requestId) revalidatePath(`/reparos/${requestId}`);
}

/** Unidades que o usuário pode escolher ao abrir um chamado. */
export async function listarUnidadesParaReparoAction(): Promise<
  ActionResult<Array<{ id: string; code: string; name: string; type: string; city: string | null }>>
> {
  return runAction(async () => {
    const context = await requirePermission("manutencao:create");

    const branches = await listRequestableBranchesForMaintenance(context);

    return actionSuccess(
      branches.map((branch) => ({
        id: branch.id,
        code: branch.code,
        name: branch.name,
        type: branch.type,
        city: branch.city,
      })),
    );
  });
}

/** Pessoas que podem receber o chamado nesta unidade. */
export async function listarResponsaveisManutencaoAction(
  branchId: string,
): Promise<ActionResult<Array<{ id: string; name: string }>>> {
  return runAction(async () => {
    const context = await requirePermission("manutencao:atender");

    return actionSuccess(await listMaintenanceAssignees(context, branchId));
  });
}

export async function abrirReparoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ requestId: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("manutencao:create");
    const values = formDataToValues(formData);

    const parsed = maintenanceCreateSchema.safeParse({
      branchId: readText(values, "branchId"),
      sectorId: readText(values, "sectorId"),
      category: readText(values, "category"),
      title: readText(values, "title"),
      description: readText(values, "description"),
      location: readText(values, "location"),
      assetTag: readText(values, "assetTag"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const attachments = await storeUploadedImages(readFiles(formData, "fotos"));

    let request: { id: string; number: string };

    try {
      request = await createMaintenanceRequest(context, { ...parsed.data, attachments }, metadata);
    } catch (error) {
      await discardStoredImages(attachments);
      throw error;
    }

    revalidateMaintenance(request.id);

    return actionSuccess({ requestId: request.id });
  });

  if (result.ok) {
    redirect(`/reparos/${result.data.requestId}?criado=1`);
  }

  return result;
}

export async function assumirReparoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const context = await requirePermission("manutencao:atender");
    const requestId = readText(formDataToValues(formData), "requestId");

    if (!requestId) return { ok: false, error: "Chamado não informado." };

    const metadata = await requestMetadata();
    const result = await claimMaintenanceRequest(context, requestId, metadata);

    revalidateMaintenance(requestId);

    return actionSuccess(result, `Chamado ${result.number} assumido por você.`);
  });
}

export async function definirPrioridadeReparoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const context = await requirePermission("manutencao:atender");
    const values = formDataToValues(formData);

    const parsed = maintenancePrioritySchema.safeParse({
      requestId: readText(values, "requestId"),
      priority: readText(values, "priority"),
      comment: readText(values, "comment"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await setMaintenancePriority(context, parsed.data, metadata);

    revalidateMaintenance(parsed.data.requestId);

    return actionSuccess(undefined, "Prioridade definida. Quem abriu foi avisado.");
  });
}

export async function atribuirReparoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const context = await requirePermission("manutencao:atender");
    const values = formDataToValues(formData);

    const parsed = assignMaintenanceSchema.safeParse({
      requestId: readText(values, "requestId"),
      assignedToId: readText(values, "assignedToId"),
      comment: readText(values, "comment"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const result = await assignMaintenanceRequest(context, parsed.data, metadata);

    revalidateMaintenance(parsed.data.requestId);

    return actionSuccess(result, `Chamado atribuído a ${result.assignedTo}.`);
  });
}

export async function atualizarAndamentoReparoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const context = await requirePermission("manutencao:atender");
    const values = formDataToValues(formData);

    const parsed = maintenanceProgressSchema.safeParse({
      requestId: readText(values, "requestId"),
      status: readText(values, "status"),
      comment: readText(values, "comment"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await updateMaintenanceProgress(context, parsed.data, metadata);

    revalidateMaintenance(parsed.data.requestId);

    return actionSuccess(
      undefined,
      parsed.data.status === "WAITING_PARTS"
        ? "Chamado marcado como aguardando peça."
        : "Andamento registrado.",
    );
  });
}

export async function concluirReparoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const context = await requirePermission("manutencao:atender");
    const values = formDataToValues(formData);

    const parsed = maintenanceCompleteSchema.safeParse({
      requestId: readText(values, "requestId"),
      resolution: readText(values, "resolution"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const result = await completeMaintenanceRequest(context, parsed.data, metadata);

    revalidateMaintenance(parsed.data.requestId);

    return actionSuccess(
      result,
      `Chamado ${result.number} concluído em ${result.resolutionHours}h.`,
    );
  });
}

export async function recusarReparoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const context = await requirePermission("manutencao:atender");
    const values = formDataToValues(formData);

    const parsed = maintenanceRejectSchema.safeParse({
      requestId: readText(values, "requestId"),
      reason: readText(values, "reason"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const result = await rejectMaintenanceRequest(context, parsed.data, metadata);

    revalidateMaintenance(parsed.data.requestId);

    return actionSuccess(result, `Chamado ${result.number} recusado.`);
  });
}

export async function cancelarReparoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const context = await requirePermission("manutencao:create");
    const values = formDataToValues(formData);

    const requestId = readText(values, "requestId");

    if (!requestId) return { ok: false, error: "Chamado não informado." };

    const metadata = await requestMetadata();
    const result = await cancelMaintenanceRequest(
      context,
      { requestId, reason: readText(values, "reason") },
      metadata,
    );

    revalidateMaintenance(requestId);

    return actionSuccess(result, `Chamado ${result.number} cancelado.`);
  });
}
