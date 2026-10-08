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
import {
  assetAssignSchema,
  assetRetireSchema,
  assetReturnSchema,
  assetTransferSchema,
} from "@/lib/validation/patrimonio";
import { assignAsset, retireAsset, returnAsset, transferAsset } from "@/server/services/patrimonio";

/** Ações do patrimônio: atribuir responsável, devolver e dar baixa. */

function revalidateAsset(assetId: string) {
  revalidatePath("/patrimonio");
  revalidatePath(`/patrimonio/${assetId}`);
}

export async function atribuirPatrimonioAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("patrimonio:manage");
    const values = formDataToValues(formData);

    const parsed = assetAssignSchema.safeParse({
      assetId: readText(values, "assetId"),
      custodianUserId: readText(values, "custodianUserId"),
      notes: readText(values, "notes"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await assignAsset(context, parsed.data, metadata);

    revalidateAsset(parsed.data.assetId);

    return actionSuccess(undefined, "Responsável definido.");
  });
}

export async function devolverPatrimonioAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("patrimonio:manage");
    const values = formDataToValues(formData);

    const parsed = assetReturnSchema.safeParse({
      assetId: readText(values, "assetId"),
      notes: readText(values, "notes"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await returnAsset(context, parsed.data, metadata);

    revalidateAsset(parsed.data.assetId);

    return actionSuccess(undefined, "Bem devolvido ao almoxarifado.");
  });
}

export async function transferirPatrimonioAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("patrimonio:manage");
    const values = formDataToValues(formData);

    const parsed = assetTransferSchema.safeParse({
      assetId: readText(values, "assetId"),
      destinationBranchId: readText(values, "destinationBranchId"),
      notes: readText(values, "notes"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const result = await transferAsset(context, parsed.data, metadata);

    revalidatePath("/patrimonio");
    revalidatePath(`/patrimonio/${parsed.data.assetId}`);

    return actionSuccess(undefined, `Bem transferido para ${result.destinationName}.`);
  });
}

export async function baixarPatrimonioAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("patrimonio:manage");
    const values = formDataToValues(formData);

    const parsed = assetRetireSchema.safeParse({
      assetId: readText(values, "assetId"),
      reason: readText(values, "reason"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await retireAsset(context, parsed.data, metadata);

    revalidateAsset(parsed.data.assetId);

    return actionSuccess(undefined, "Bem baixado.");
  });
}
