"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { actionSuccess, type ActionResult } from "@/lib/action-result";
import { runAction } from "@/server/actions/run";
import { requirePermission } from "@/server/auth/guards";
import {
  formDataToValues,
  readList,
  readText,
  requestMetadata,
  validationFailure,
} from "@/server/actions/helpers";
import { transferCreateSchema, transferReceiveSchema } from "@/lib/validation/transfer";
import {
  cancelTransfer,
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  returnTransfer,
  sendTransfer,
} from "@/server/services/transfer";

/** Ações de transferência entre unidades. */

function readLines(values: Record<string, string | string[] | undefined>) {
  const itemIds = readList(values, "lineItemId");
  const quantities = readList(values, "lineQuantity");
  const notes = readList(values, "lineNotes");

  return itemIds.map((itemId, index) => ({
    itemId,
    quantity: quantities[index] ?? "0",
    notes: notes[index],
  }));
}

export async function criarTransferenciaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ transferId: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("transferencia:create");
    const values = formDataToValues(formData);

    const parsed = transferCreateSchema.safeParse({
      originBranchId: readText(values, "originBranchId"),
      destinationBranchId: readText(values, "destinationBranchId"),
      priority: readText(values, "priority") ?? "NORMAL",
      notes: readText(values, "notes"),
      lines: readLines(values),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const transfer = await createTransfer(context, parsed.data, metadata);

    revalidatePath("/transferencias");

    return actionSuccess({ transferId: transfer.id });
  });

  if (result.ok) {
    redirect(`/transferencias/${result.data.transferId}?criada=1`);
  }

  return result;
}

export async function enviarTransferenciaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("transferencia:enviar");
    const transferId = readText(formDataToValues(formData), "transferId");

    if (!transferId) return { ok: false, error: "Transferência não informada." };

    const metadata = await requestMetadata();
    const result = await sendTransfer(context, transferId, metadata);

    revalidatePath("/transferencias");
    revalidatePath(`/transferencias/${transferId}`);
    revalidatePath("/estoque/saldos");

    return actionSuccess(
      undefined,
      `Transferência enviada. Documento ${result.documentNumber} baixado na origem.`,
    );
  });
}

export async function despacharTransferenciaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("transferencia:enviar");
    const transferId = readText(formDataToValues(formData), "transferId");

    if (!transferId) return { ok: false, error: "Transferência não informada." };

    const metadata = await requestMetadata();
    await dispatchTransfer(context, transferId, metadata);

    revalidatePath("/transferencias");
    revalidatePath(`/transferencias/${transferId}`);

    return actionSuccess(undefined, "Saída confirmada. Material em trânsito.");
  });
}

export async function receberTransferenciaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const context = await requirePermission("transferencia:receber");
    const values = formDataToValues(formData);

    const lineIds = readList(values, "lineId");
    const quantities = readList(values, "lineQuantityReceived");

    const parsed = transferReceiveSchema.safeParse({
      transferId: readText(values, "transferId"),
      comment: readText(values, "comment"),
      lines: lineIds.map((lineId, index) => ({
        lineId,
        quantityReceived: quantities[index] ?? "0",
      })),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const result = await receiveTransfer(context, parsed.data, metadata);

    revalidatePath("/transferencias");
    revalidatePath(`/transferencias/${parsed.data.transferId}`);
    revalidatePath("/estoque/saldos");

    return actionSuccess(
      result,
      result.fullyReceived
        ? "Transferência recebida integralmente."
        : "Recebimento parcial registrado. O restante continua em trânsito.",
    );
  });
}

export async function devolverTransferenciaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("transferencia:receber");
    const values = formDataToValues(formData);

    const transferId = readText(values, "transferId");
    const reason = readText(values, "reason");

    if (!transferId) return { ok: false, error: "Transferência não informada." };
    if (!reason || reason.trim().length < 5) {
      return { ok: false, error: "Informe o motivo da devolução." };
    }

    const metadata = await requestMetadata();
    const result = await returnTransfer(context, { transferId, reason }, metadata);

    revalidatePath("/transferencias");
    revalidatePath(`/transferencias/${transferId}`);
    revalidatePath("/estoque/saldos");

    return actionSuccess(undefined, `Devolução lançada. Documento ${result.documentNumber}.`);
  });
}

export async function cancelarTransferenciaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("transferencia:create");
    const values = formDataToValues(formData);

    const transferId = readText(values, "transferId");
    const reason = readText(values, "reason");

    if (!transferId) return { ok: false, error: "Transferência não informada." };
    if (!reason || reason.trim().length < 5) {
      return { ok: false, error: "Informe o motivo do cancelamento." };
    }

    const metadata = await requestMetadata();
    await cancelTransfer(context, { transferId, reason }, metadata);

    revalidatePath("/transferencias");
    revalidatePath(`/transferencias/${transferId}`);
    revalidatePath("/estoque/saldos");

    return actionSuccess(undefined, "Transferência cancelada.");
  });
}
