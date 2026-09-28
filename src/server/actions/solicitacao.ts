"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Prisma } from "@/generated/prisma/client";

import { actionSuccess, runAction, type ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/db";
import { availableQuantity } from "@/server/services/stock/average-cost";
import { requirePermission } from "@/server/auth/guards";
import {
  formDataToValues,
  readFiles,
  readList,
  readText,
  requestMetadata,
  validationFailure,
} from "@/server/actions/helpers";
import { discardStoredImages, storeUploadedImages } from "@/server/services/attachment";
import {
  requestApprovalSchema,
  requestCreateSchema,
  requestDeliverySchema,
} from "@/lib/validation/request";
import {
  approveRequest,
  cancelRequest,
  claimRequest,
  createRequest,
  deliverRequest,
  listRequestableBranches,
  rejectRequest,
  startPreparation,
} from "@/server/services/request";

/** Ações do fluxo de solicitação de material. */

function revalidateRequestViews(requestId?: string) {
  revalidatePath("/solicitacoes");
  revalidatePath("/solicitacoes/fila");
  revalidatePath("/entregas");
  revalidatePath("/meu");
  revalidatePath("/notificacoes");
  revalidatePath("/dashboard");

  if (requestId) revalidatePath(`/solicitacoes/${requestId}`);
}

/* -------------------------------------------------------------------------- */
/* Solicitante                                                                 */
/* -------------------------------------------------------------------------- */

function readRequestLines(values: Record<string, string | string[] | undefined>) {
  const itemIds = readList(values, "lineItemId");
  const quantities = readList(values, "lineQuantity");
  const notes = readList(values, "lineNotes");

  return itemIds.map((itemId, index) => ({
    itemId,
    quantity: quantities[index] ?? "0",
    lineNotes: notes[index],
  }));
}

export async function criarSolicitacaoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ requestId: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("solicitacao:create");
    const values = formDataToValues(formData);

    const parsed = requestCreateSchema.safeParse({
      branchId: readText(values, "branchId"),
      sectorId: readText(values, "sectorId"),
      neededAt: readText(values, "neededAt"),
      notes: readText(values, "notes"),
      lines: readRequestLines(values),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const attachments = await storeUploadedImages(readFiles(formData, "fotos"));

    let request: { id: string; number: string };

    try {
      request = await createRequest(context, { ...parsed.data, attachments }, metadata);
    } catch (error) {
      await discardStoredImages(attachments);
      throw error;
    }

    revalidateRequestViews(request.id);

    return actionSuccess({ requestId: request.id });
  });

  if (result.ok) {
    redirect(`/solicitacoes/${result.data.requestId}?criada=1`);
  }

  return result;
}

/**
 * Lista as unidades que o solicitante pode escolher.
 *
 * Qualquer unidade ativa: o colaborador pode estar em outra unidade e precisa
 * pedir material de lá. Quem resolve é quem recebe o pedido.
 */
export async function listarUnidadesParaSolicitarAction(): Promise<
  ActionResult<Array<{ id: string; code: string; name: string; type: string; city: string | null }>>
> {
  return runAction(async () => {
    const context = await requirePermission("solicitacao:create");

    const branches = await listRequestableBranches(context);

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

export async function cancelarSolicitacaoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("solicitacao:create");
    const values = formDataToValues(formData);

    const requestId = readText(values, "requestId");
    const reason = readText(values, "reason");

    if (!requestId) return { ok: false, error: "Solicitação não informada." };

    const metadata = await requestMetadata();
    await cancelRequest(context, { requestId, reason }, metadata);

    revalidateRequestViews(requestId);

    return actionSuccess(undefined, "Solicitação cancelada.");
  });
}

/* -------------------------------------------------------------------------- */
/* Aprovador                                                                   */
/* -------------------------------------------------------------------------- */

export async function assumirSolicitacaoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("solicitacao:approve");
    const requestId = readText(formDataToValues(formData), "requestId");

    if (!requestId) return { ok: false, error: "Solicitação não informada." };

    const metadata = await requestMetadata();
    await claimRequest(context, requestId, metadata);

    revalidateRequestViews(requestId);

    return actionSuccess(undefined, "Solicitação assumida. Os outros aprovadores foram avisados.");
  });
}

export async function decidirSolicitacaoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<unknown>> {
  return runAction<unknown>(async () => {
    const context = await requirePermission("solicitacao:approve");
    const values = formDataToValues(formData);

    const lineIds = readList(values, "lineId");
    const approvedQuantities = readList(values, "lineApprovedQuantity");
    const reasons = readList(values, "lineNonApprovalReason");
    const decision = readText(values, "decision");

    const parsed = requestApprovalSchema.safeParse({
      requestId: readText(values, "requestId"),
      decision: decision ?? "approve",
      priority: readText(values, "priority") ?? "NORMAL",
      comment: readText(values, "comment"),
      reason: readText(values, "reason"),
      lines: lineIds.map((lineId, index) => ({
        lineId,
        approvedQuantity: approvedQuantities[index] ?? "0",
        nonApprovalReason: reasons[index],
      })),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();

    if (parsed.data.decision === "reject") {
      const result = await rejectRequest(
        context,
        { requestId: parsed.data.requestId, reason: parsed.data.reason ?? "" },
        metadata,
      );

      revalidateRequestViews(parsed.data.requestId);

      return actionSuccess({ rejected: true }, `Solicitação ${result.number} rejeitada.`);
    }

    const result = await approveRequest(
      context,
      {
        requestId: parsed.data.requestId,
        priority: parsed.data.priority,
        lines: parsed.data.lines,
        comment: parsed.data.comment,
      },
      metadata,
    );

    revalidateRequestViews(parsed.data.requestId);
    revalidatePath("/estoque/saldos");

    return actionSuccess(
      result,
      result.fullyApproved
        ? "Solicitação aprovada. O saldo foi reservado."
        : "Solicitação aprovada parcialmente. O saldo reservado corresponde ao aprovado.",
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Almoxarife                                                                  */
/* -------------------------------------------------------------------------- */

export async function iniciarSeparacaoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("solicitacao:entregar");
    const requestId = readText(formDataToValues(formData), "requestId");

    if (!requestId) return { ok: false, error: "Solicitação não informada." };

    const metadata = await requestMetadata();
    await startPreparation(context, requestId, metadata);

    revalidateRequestViews(requestId);

    return actionSuccess(undefined, "Separação iniciada.");
  });
}

export async function registrarEntregaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ documentNumber: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("solicitacao:entregar");
    const values = formDataToValues(formData);

    const lineIds = readList(values, "lineId");
    const deliveredQuantities = readList(values, "lineDeliveredQuantity");

    const parsed = requestDeliverySchema.safeParse({
      requestId: readText(values, "requestId"),
      receivedByName: readText(values, "receivedByName"),
      receivedByDocument: readText(values, "receivedByDocument"),
      notes: readText(values, "notes"),
      lines: lineIds.map((lineId, index) => ({
        lineId,
        deliveredQuantity: deliveredQuantities[index] ?? "0",
      })),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const delivery = await deliverRequest(context, parsed.data, metadata);

    revalidateRequestViews(parsed.data.requestId);
    revalidatePath("/estoque/saldos");
    revalidatePath("/estoque/movimentacoes");

    return actionSuccess(
      { documentNumber: delivery.documentNumber },
      `Entrega registrada. Saída ${delivery.documentNumber} lançada no estoque.`,
    );
  });

  if (result.ok) {
    redirect(`/solicitacoes/${readText(formDataToValues(formData), "requestId") ?? ""}?entregue=1`);
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Consulta usada pelo formulário                                              */
/* -------------------------------------------------------------------------- */

/**
 * Disponibilidade por material na unidade.
 *
 * O formulário usa isso para mostrar "12 disponíveis" enquanto o solicitante
 * monta o pedido. Não bloqueia o pedido — quem decide é o aprovador.
 */
export async function consultarDisponibilidadeAction(
  branchId: string,
  itemIds: string[],
): Promise<
  ActionResult<
    Record<string, { available: string; status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" }>
  >
> {
  return runAction(async () => {
    const context = await requirePermission("solicitacao:create");

    if (!context.branchIds.includes(branchId)) {
      return { ok: false, error: "Sem acesso a esta unidade." };
    }

    const levels = await prisma.stockLevel.findMany({
      where: { branchId, itemId: { in: itemIds } },
      select: { itemId: true, quantity: true, reservedQuantity: true },
    });

    const availableByItem = new Map<string, Prisma.Decimal>();

    for (const level of levels) {
      const current = availableByItem.get(level.itemId) ?? new Prisma.Decimal(0);

      availableByItem.set(
        level.itemId,
        current.plus(availableQuantity(level.quantity, level.reservedQuantity)),
      );
    }

    const result: Record<
      string,
      { available: string; status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" }
    > = {};

    for (const itemId of itemIds) {
      const available = availableByItem.get(itemId) ?? new Prisma.Decimal(0);

      result[itemId] = {
        available: available.toString(),
        status: available.greaterThan(0) ? "PARTIAL" : "UNAVAILABLE",
      };
    }

    return actionSuccess(result);
  });
}
