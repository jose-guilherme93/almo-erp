"use server";

import { Prisma } from "@/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { actionSuccess, runAction, type ActionResult } from "@/lib/action-result";
import { BusinessRuleError } from "@/lib/errors";
import { requireAnyPermission, requirePermission } from "@/server/auth/guards";
import { resolveWorkingBranch } from "@/server/auth/scope";
import {
  formDataToValues,
  readList,
  readText,
  requestMetadata,
  validationFailure,
} from "@/server/actions/helpers";
import { prisma } from "@/lib/db";
import {
  cancelStockDocument,
  createAndPostStockDocument,
  previewStockImpact,
} from "@/server/services/stock/post-document";
import { stockDocumentInputSchema } from "@/lib/validation/stock";

/** Ações de estoque: entradas, ajustes e cancelamento de movimentação. */

const d = (value: string | number) => new Prisma.Decimal(value);

/**
 * Lê as linhas do formulário.
 *
 * O formulário envia arrays paralelos (`itemId[]`, `quantity[]`...). Índices
 * desalinhados significariam lançar quantidade no material errado, então a
 * leitura valida o alinhamento antes de montar as linhas.
 */
function readLines(values: Record<string, string | string[] | undefined>) {
  const itemIds = readList(values, "lineItemId");
  const quantities = readList(values, "lineQuantity");
  const unitCosts = readList(values, "lineUnitCost");
  const lotIds = readList(values, "lineLotId");

  if (itemIds.length === 0) return [];

  return itemIds.map((itemId, index) => ({
    itemId,
    quantity: quantities[index] ?? "0",
    unitCost: unitCosts[index] ?? "0",
    itemLotId: lotIds[index] ?? "",
  }));
}

function readDocumentForm(formData: FormData) {
  const values = formDataToValues(formData);

  return {
    storageLocationId: readText(values, "storageLocationId"),
    date: readText(values, "date"),
    notes: readText(values, "notes"),
    referenceType: readText(values, "referenceType"),
    referenceId: readText(values, "referenceId"),
    supplierName: readText(values, "supplierName"),
    justification: readText(values, "justification"),
    lines: readLines(values),
  };
}

export async function lancarEntradaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ documentId: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("estoque:entrada");
    const form = readDocumentForm(formData);
    const branchId = resolveWorkingBranch(
      context,
      readText(formDataToValues(formData), "branchId"),
    );

    const parsed = stockDocumentInputSchema.safeParse({
      ...form,
      branchId,
      type: "INBOUND",
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();

    const posted = await createAndPostStockDocument(
      {
        type: "INBOUND",
        branchId,
        storageLocationId: parsed.data.storageLocationId,
        date: parsed.data.date ? new Date(parsed.data.date) : new Date(),
        notes: parsed.data.notes,
        referenceType: parsed.data.referenceType ?? "MANUAL_INBOUND",
        referenceId: parsed.data.referenceId,
        createdById: context.user.id,
        lines: parsed.data.lines.map((line) => ({
          itemId: line.itemId,
          itemLotId: line.itemLotId,
          quantity: d(line.quantity).abs(),
          unitCost: d(line.unitCost),
        })),
      },
      metadata,
    );

    revalidatePath("/estoque");
    revalidatePath("/estoque/saldos");
    revalidatePath("/estoque/movimentacoes");
    revalidatePath("/estoque/entradas");

    return actionSuccess({ documentId: posted.documentId });
  });

  if (result.ok) {
    redirect(`/estoque/movimentacoes/${result.data.documentId}?criado=1`);
  }

  return result;
}

export async function lancarAjusteAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ documentId: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("estoque:ajuste");
    const form = readDocumentForm(formData);
    const branchId = resolveWorkingBranch(
      context,
      readText(formDataToValues(formData), "branchId"),
    );

    const parsed = stockDocumentInputSchema.safeParse({
      ...form,
      branchId,
      type: "ADJUSTMENT",
    });

    if (!parsed.success) return validationFailure(parsed.error);

    // Ajuste sem justificativa é um furo de auditoria: o motivo é a única
    // explicação de por que o saldo mudou sem documento de origem.
    if (!parsed.data.justification || parsed.data.justification.trim().length < 10) {
      throw new BusinessRuleError(
        "A justificativa do ajuste é obrigatória e precisa explicar o motivo (mínimo 10 caracteres).",
      );
    }

    const metadata = await requestMetadata();

    // No ajuste, o sinal vem do formulário (positivo ou negativo).
    const posted = await createAndPostStockDocument(
      {
        type: "ADJUSTMENT",
        branchId,
        storageLocationId: parsed.data.storageLocationId,
        date: parsed.data.date ? new Date(parsed.data.date) : new Date(),
        notes: `Ajuste: ${parsed.data.justification}`,
        referenceType: "MANUAL_ADJUSTMENT",
        createdById: context.user.id,
        lines: parsed.data.lines.map((line) => ({
          itemId: line.itemId,
          itemLotId: line.itemLotId,
          quantity: d(line.quantity),
          unitCost: d(line.unitCost),
        })),
      },
      metadata,
    );

    revalidatePath("/estoque");
    revalidatePath("/estoque/saldos");
    revalidatePath("/estoque/movimentacoes");
    revalidatePath("/estoque/ajustes");

    return actionSuccess({ documentId: posted.documentId });
  });

  if (result.ok) {
    redirect(`/estoque/movimentacoes/${result.data.documentId}?criado=1`);
  }

  return result;
}

export async function cancelarDocumentoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requireAnyPermission(["estoque:ajuste", "estoque:entrada"]);
    const values = formDataToValues(formData);

    const documentId = readText(values, "documentId");
    const reason = readText(values, "reason");

    if (!documentId) return { ok: false, error: "Movimentação não informada." };
    if (!reason || reason.trim().length < 5) {
      return { ok: false, error: "Informe o motivo do cancelamento." };
    }

    const document = await prisma.stockDocument.findFirst({
      where: { id: documentId, branchId: { in: context.branchIds } },
      select: { id: true, branchId: true },
    });

    if (!document) {
      return { ok: false, error: "Movimentação não encontrada nesta unidade." };
    }

    const metadata = await requestMetadata();

    await cancelStockDocument({ documentId, createdById: context.user.id, reason }, metadata);

    revalidatePath("/estoque/saldos");
    revalidatePath("/estoque/movimentacoes");
    revalidatePath(`/estoque/movimentacoes/${documentId}`);

    return actionSuccess(undefined, "Movimentação cancelada e saldo estornado.");
  });
}

/**
 * Pré-visualização do impacto no saldo, mostrada antes de confirmar.
 *
 * Evita o susto: o usuário vê quanto vai ficar o saldo de cada item.
 */
export async function calcularImpactoAction(
  storageLocationId: string,
  lines: Array<{ itemId: string; quantity: string }>,
): Promise<ActionResult<Awaited<ReturnType<typeof previewStockImpact>>>> {
  return runAction(async () => {
    const context = await requireAnyPermission([
      "estoque:entrada",
      "estoque:ajuste",
      "estoque:saida",
    ]);

    const location = await prisma.storageLocation.findFirst({
      where: { id: storageLocationId, branchId: { in: context.branchIds } },
      select: { id: true },
    });

    if (!location) {
      return { ok: false, error: "Local de estoque não encontrado." };
    }

    const impact = await previewStockImpact(
      prisma,
      storageLocationId,
      lines.map((line) => ({ itemId: line.itemId, quantity: d(line.quantity) })),
    );

    return actionSuccess(impact);
  });
}

/**
 * Lotes válidos de um material, para o select da linha.
 *
 * Lotes vencidos não aparecem: o motor de estoque os recusaria de todo modo,
 * e mostrá-los só faria o usuário perder tempo.
 */
export async function listarLotesAction(
  itemId: string,
): Promise<ActionResult<Array<{ id: string; code: string; expirationDate: string | null }>>> {
  return runAction(async () => {
    await requireAnyPermission(["estoque:entrada", "estoque:ajuste", "estoque:saida"]);

    const lots = await prisma.itemLot.findMany({
      where: {
        itemId,
        active: true,
        OR: [{ expirationDate: null }, { expirationDate: { gt: new Date() } }],
      },
      orderBy: [{ expirationDate: "asc" }, { code: "asc" }],
      select: { id: true, code: true, expirationDate: true },
    });

    return actionSuccess(
      lots.map((lot) => ({
        id: lot.id,
        code: lot.code,
        expirationDate: lot.expirationDate
          ? lot.expirationDate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
          : null,
      })),
    );
  });
}
