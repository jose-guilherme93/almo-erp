"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { actionSuccess, runAction, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/server/auth/guards";
import { resolveWorkingBranch } from "@/server/auth/scope";
import {
  formDataToValues,
  readList,
  readNumber,
  readText,
  requestMetadata,
  validationFailure,
} from "@/server/actions/helpers";
import {
  inventoryAdjustmentSchema,
  inventoryCountSchema,
  inventoryCreateSchema,
} from "@/lib/validation/inventory";
import {
  applyInventoryAdjustment,
  cancelInventorySession,
  closeInventoryCounting,
  createInventorySession,
  saveCountBatch,
} from "@/server/services/inventory";

/** Ações do inventário. */

function revalidateInventory(sessionId?: string) {
  revalidatePath("/inventario");
  revalidatePath("/estoque/saldos");
  revalidatePath("/estoque/movimentacoes");
  revalidatePath("/dashboard");

  if (sessionId) revalidatePath(`/inventario/${sessionId}`);
}

export async function criarInventarioAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ sessionId: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("inventario:manage");
    const values = formDataToValues(formData);

    const parsed = inventoryCreateSchema.safeParse({
      branchId: resolveWorkingBranch(context, readText(values, "branchId")),
      storageLocationId: readText(values, "storageLocationId"),
      categoryId: readText(values, "categoryId"),
      onlyWithoutMovementDays: readNumber(values, "onlyWithoutMovementDays"),
      notes: readText(values, "notes"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const session = await createInventorySession(context, parsed.data, metadata);

    revalidateInventory(session.id);

    return actionSuccess({ sessionId: session.id });
  });

  if (result.ok) {
    redirect(`/inventario/${result.data.sessionId}?criado=1`);
  }

  return result;
}

/** Salva a contagem em lote: a tela manda tudo de uma vez ao confirmar. */
export async function salvarContagemAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: number }>> {
  return runAction(async () => {
    const context = await requirePermission("inventario:manage");
    const values = formDataToValues(formData);

    const lineIds = readList(values, "lineId");
    const quantities = readList(values, "countedQuantity");

    const parsed = inventoryCountSchema.safeParse({
      sessionId: readText(values, "sessionId"),
      counts: lineIds.map((lineId, index) => ({
        lineId,
        countedQuantity: quantities[index] ?? "",
      })),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const saved = await saveCountBatch(
      context,
      parsed.data.sessionId,
      parsed.data.counts.map((count) => ({
        lineId: count.lineId,
        countedQuantity: count.countedQuantity,
      })),
    );

    revalidateInventory(parsed.data.sessionId);

    return actionSuccess({ saved }, `${saved} contagem(ns) salva(s).`);
  });
}

export async function fecharContagemAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const context = await requirePermission("inventario:manage");
    const values = formDataToValues(formData);

    const sessionId = readText(values, "sessionId");
    if (!sessionId) return { ok: false, error: "Inventário não informado." };

    const metadata = await requestMetadata();
    const result = await closeInventoryCounting(
      context,
      { sessionId, notes: readText(values, "notes") },
      metadata,
    );

    revalidateInventory(sessionId);

    return actionSuccess(
      result,
      `Contagem encerrada: ${result.counted} de ${result.total} itens contados.`,
    );
  });
}

export async function aplicarAjusteInventarioAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  const result = await runAction(async () => {
    const context = await requirePermission("inventario:manage");
    const values = formDataToValues(formData);

    const lineIds = readList(values, "lineId");
    const justifications = readList(values, "justification");

    const parsed = inventoryAdjustmentSchema.safeParse({
      sessionId: readText(values, "sessionId"),
      justifications: lineIds.map((lineId, index) => ({
        lineId,
        justification: justifications[index] ?? "",
      })),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const applied = await applyInventoryAdjustment(context, parsed.data, metadata);

    revalidateInventory(parsed.data.sessionId);

    return actionSuccess(
      applied,
      `Ajuste lançado para ${applied.divergentLines} item(ns). Documento(s): ${applied.documentNumbers.join(", ")}.`,
    );
  });

  if (result.ok) {
    redirect(`/inventario/${readText(formDataToValues(formData), "sessionId") ?? ""}?ajustado=1`);
  }

  return result;
}

export async function cancelarInventarioAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return runAction(async () => {
    const context = await requirePermission("inventario:manage");
    const values = formDataToValues(formData);

    const sessionId = readText(values, "sessionId");
    const reason = readText(values, "reason");

    if (!sessionId) return { ok: false, error: "Inventário não informado." };
    if (!reason || reason.trim().length < 5) {
      return { ok: false, error: "Informe o motivo do cancelamento." };
    }

    const metadata = await requestMetadata();
    await cancelInventorySession(context, { sessionId, reason }, metadata);

    revalidateInventory(sessionId);

    return actionSuccess(undefined, "Inventário cancelado.");
  });
}
