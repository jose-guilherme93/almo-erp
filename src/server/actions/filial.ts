"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { actionSuccess, type ActionResult } from "@/lib/action-result";
import { runAction } from "@/server/actions/run";
import {
  createBranchSchema,
  deactivateBranchSchema,
  storageLocationSchema,
  updateBranchSchema,
  updateStorageLocationSchema,
} from "@/lib/validation/branch";
import { requirePermission } from "@/server/auth/guards";
import {
  formDataToValues,
  readBoolean,
  readNumber,
  readText,
  requestMetadata,
  validationFailure,
} from "@/server/actions/helpers";
import {
  createBranch,
  createStorageLocation,
  deactivateBranch,
  deactivateStorageLocation,
  reactivateBranch,
  updateBranch,
  updateStorageLocation,
} from "@/server/services/branch";

/** Ações do cadastro de unidades e locais de estoque. */

function readBranchForm(formData: FormData) {
  const values = formDataToValues(formData);

  return {
    code: readText(values, "code"),
    name: readText(values, "name"),
    type: readText(values, "type"),
    legalName: readText(values, "legalName"),
    tradeName: readText(values, "tradeName"),
    cnpj: readText(values, "cnpj"),
    stateRegistration: readText(values, "stateRegistration"),
    cnae: readText(values, "cnae"),

    zipCode: readText(values, "zipCode"),
    street: readText(values, "street"),
    number: readText(values, "number"),
    complement: readText(values, "complement"),
    district: readText(values, "district"),
    city: readText(values, "city"),
    state: readText(values, "state"),
    country: readText(values, "country") ?? "Brasil",
    latitude: readNumber(values, "latitude"),
    longitude: readNumber(values, "longitude"),

    email: readText(values, "email"),
    phone: readText(values, "phone"),
    whatsapp: readText(values, "whatsapp"),

    legalResponsibleId: readText(values, "legalResponsibleId"),
    legalResponsibleName: readText(values, "legalResponsibleName"),
    legalResponsibleDocument: readText(values, "legalResponsibleDocument"),
    warehouseResponsibleId: readText(values, "warehouseResponsibleId"),
    notificationResponsibleId: readText(values, "notificationResponsibleId"),
    defaultApproverId: readText(values, "defaultApproverId"),

    notes: readText(values, "notes"),
    parentId: readText(values, "parentId"),
    active: readBoolean(values, "active"),
  };
}

export async function criarFilialAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ branchId: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("filial:create");

    const parsed = createBranchSchema.safeParse(readBranchForm(formData));

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const branch = await createBranch(context, parsed.data, metadata);

    revalidatePath("/filiais");
    revalidatePath("/dashboard");

    return actionSuccess({ branchId: branch.id });
  });

  if (result.ok) {
    redirect(`/filiais/${result.data.branchId}?criada=1`);
  }

  return result;
}

export async function atualizarFilialAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ branchId: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("filial:manage");
    const values = formDataToValues(formData);

    const parsed = updateBranchSchema.safeParse({
      ...readBranchForm(formData),
      branchId: readText(values, "branchId"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const branch = await updateBranch(context, parsed.data, metadata);

    revalidatePath("/filiais");
    revalidatePath(`/filiais/${branch.id}`);

    return actionSuccess({ branchId: branch.id });
  });

  if (result.ok) {
    redirect(`/filiais/${result.data.branchId}?salva=1`);
  }

  return result;
}

export async function desativarFilialAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("filial:manage");
    const values = formDataToValues(formData);

    const parsed = deactivateBranchSchema.safeParse({
      branchId: readText(values, "branchId"),
      reason: readText(values, "reason"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await deactivateBranch(context, parsed.data, metadata);

    revalidatePath("/filiais");
    revalidatePath(`/filiais/${parsed.data.branchId}`);

    return actionSuccess(undefined, "Unidade desativada.");
  });
}

export async function reativarFilialAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("filial:manage");
    const values = formDataToValues(formData);
    const branchId = readText(values, "branchId");

    if (!branchId) return { ok: false, error: "Unidade não informada." };

    const metadata = await requestMetadata();
    await reactivateBranch(context, branchId, metadata);

    revalidatePath("/filiais");
    revalidatePath(`/filiais/${branchId}`);

    return actionSuccess(undefined, "Unidade reativada.");
  });
}

/* -------------------------------------------------------------------------- */
/* Locais de estoque                                                          */
/* -------------------------------------------------------------------------- */

function readLocationForm(formData: FormData) {
  const values = formDataToValues(formData);

  return {
    branchId: readText(values, "branchId"),
    code: readText(values, "code"),
    name: readText(values, "name"),
    type: readText(values, "type"),
    description: readText(values, "description"),
    responsibleId: readText(values, "responsibleId"),
    active: readBoolean(values, "active"),
  };
}

export async function criarLocalEstoqueAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ locationId: string }>> {
  return runAction(async () => {
    const context = await requirePermission("local:manage");

    const parsed = storageLocationSchema.safeParse(readLocationForm(formData));

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const location = await createStorageLocation(context, parsed.data, metadata);

    revalidatePath(`/filiais/${parsed.data.branchId}`);

    return actionSuccess({ locationId: location.id }, "Local de estoque criado.");
  });
}

export async function atualizarLocalEstoqueAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ locationId: string }>> {
  return runAction(async () => {
    const context = await requirePermission("local:manage");
    const values = formDataToValues(formData);

    const parsed = updateStorageLocationSchema.safeParse({
      ...readLocationForm(formData),
      locationId: readText(values, "locationId"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await updateStorageLocation(context, parsed.data, metadata);

    revalidatePath(`/filiais/${parsed.data.branchId}`);

    return actionSuccess({ locationId: parsed.data.locationId }, "Local atualizado.");
  });
}

export async function desativarLocalEstoqueAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("local:manage");
    const values = formDataToValues(formData);

    const locationId = readText(values, "locationId");
    const branchId = readText(values, "branchId");

    if (!locationId || !branchId) {
      return { ok: false, error: "Local não informado." };
    }

    const metadata = await requestMetadata();
    await deactivateStorageLocation(context, locationId, metadata);

    revalidatePath(`/filiais/${branchId}`);

    return actionSuccess(undefined, "Local desativado.");
  });
}
