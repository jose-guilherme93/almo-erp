"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { actionSuccess, runAction, type ActionResult } from "@/lib/action-result";
import { NotFoundError } from "@/lib/errors";
import type { ItemPickOption } from "@/lib/item-option";
import {
  itemLotSchema,
  itemQuickSchema,
  itemSchema,
  itemStockPolicySchema,
  itemUpdateSchema,
} from "@/lib/validation/catalog";
import { requireAnyPermission, requirePermission } from "@/server/auth/guards";
import {
  formDataToValues,
  readBoolean,
  readList,
  readNumber,
  readText,
  requestMetadata,
  validationFailure,
} from "@/server/actions/helpers";
import {
  assignStockPolicy,
  createItem,
  createItemLot,
  deactivateItem,
  deactivateItemLot,
  findItemByBarcode,
  getItemPickOption,
  removeStockPolicy,
  searchItems,
  updateItem,
} from "@/server/services/catalog/item";

/** Ações do catálogo de materiais. */

function readItemForm(formData: FormData) {
  const values = formDataToValues(formData);

  return {
    code: readText(values, "code"),
    barcode: readText(values, "barcode"),
    name: readText(values, "name"),
    description: readText(values, "description"),
    categoryId: readText(values, "categoryId"),
    unitId: readText(values, "unitId"),
    referencePrice: readNumber(values, "referencePrice") ?? 0,
    controlledByLot: readBoolean(values, "controlledByLot"),
    perishable: readBoolean(values, "perishable"),
    requiresApproval: readBoolean(values, "requiresApproval"),
    hasSerialControl: readBoolean(values, "hasSerialControl"),
    active: readBoolean(values, "active"),
  };
}

export async function criarItemAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ itemId: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("item:create");

    const parsed = itemSchema.safeParse(readItemForm(formData));

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const item = await createItem(context, parsed.data, metadata);

    revalidatePath("/catalogo/itens");

    return actionSuccess({ itemId: item.id });
  });

  if (result.ok) {
    redirect(`/catalogo/itens/${result.data.itemId}?criado=1`);
  }

  return result;
}

export async function atualizarItemAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ itemId: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("item:manage");
    const values = formDataToValues(formData);

    const parsed = itemUpdateSchema.safeParse({
      ...readItemForm(formData),
      itemId: readText(values, "itemId"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await updateItem(context, parsed.data, metadata);

    revalidatePath("/catalogo/itens");
    revalidatePath(`/catalogo/itens/${parsed.data.itemId}`);

    return actionSuccess({ itemId: parsed.data.itemId });
  });

  if (result.ok) {
    redirect(`/catalogo/itens/${result.data.itemId}?salvo=1`);
  }

  return result;
}

export async function desativarItemAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("item:manage");
    const values = formDataToValues(formData);
    const itemId = readText(values, "itemId");

    if (!itemId) return { ok: false, error: "Material não informado." };

    const metadata = await requestMetadata();
    await deactivateItem(context, itemId, metadata);

    revalidatePath("/catalogo/itens");
    revalidatePath(`/catalogo/itens/${itemId}`);

    return actionSuccess(undefined, "Material desativado.");
  });
}

/* -------------------------------------------------------------------------- */
/* Lotes                                                                       */
/* -------------------------------------------------------------------------- */

export async function criarLoteAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ lotId: string }>> {
  return runAction(async () => {
    const context = await requirePermission("item:manage");
    const values = formDataToValues(formData);

    const parsed = itemLotSchema.safeParse({
      itemId: readText(values, "itemId"),
      code: readText(values, "code"),
      expirationDate: readText(values, "expirationDate"),
      active: readBoolean(values, "active"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const lot = await createItemLot(context, parsed.data, metadata);

    revalidatePath(`/catalogo/itens/${parsed.data.itemId}`);

    return actionSuccess({ lotId: lot.id }, "Lote cadastrado.");
  });
}

export async function desativarLoteAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("item:manage");
    const values = formDataToValues(formData);
    const lotId = readText(values, "lotId");
    const itemId = readText(values, "itemId");

    if (!lotId) return { ok: false, error: "Lote não informado." };

    const metadata = await requestMetadata();
    await deactivateItemLot(context, lotId, metadata);

    if (itemId) revalidatePath(`/catalogo/itens/${itemId}`);

    return actionSuccess(undefined, "Lote desativado.");
  });
}

/* -------------------------------------------------------------------------- */
/* Política de estoque por unidade                                             */
/* -------------------------------------------------------------------------- */

export async function definirPoliticaEstoqueAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ branches: number }>> {
  return runAction(async () => {
    const context = await requirePermission("item:manage");
    const values = formDataToValues(formData);

    const parsed = itemStockPolicySchema.safeParse({
      itemId: readText(values, "itemId"),
      branchIds: readList(values, "branchIds"),
      minimumQuantity: readNumber(values, "minimumQuantity") ?? 0,
      maximumQuantity: readNumber(values, "maximumQuantity"),
      alertQuantity: readNumber(values, "alertQuantity"),
      averageConsumption: readNumber(values, "averageConsumption"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const result = await assignStockPolicy(context, parsed.data, metadata);

    revalidatePath(`/catalogo/itens/${parsed.data.itemId}`);

    return actionSuccess(
      { branches: result.branches },
      result.branches === 1
        ? "Mínimo definido para a unidade."
        : `Mínimo definido para ${result.branches} unidades.`,
    );
  });
}

export async function removerPoliticaEstoqueAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("item:manage");
    const values = formDataToValues(formData);
    const policyId = readText(values, "policyId");
    const itemId = readText(values, "itemId");

    if (!policyId) return { ok: false, error: "Política não informada." };

    const metadata = await requestMetadata();
    await removeStockPolicy(context, policyId, metadata);

    if (itemId) revalidatePath(`/catalogo/itens/${itemId}`);

    return actionSuccess(undefined, "Mínimo removido desta unidade.");
  });
}

/* -------------------------------------------------------------------------- */
/* Consultas usadas pelo formulário e pelo leitor                              */
/* -------------------------------------------------------------------------- */

/**
 * Permissões que dão direito ao seletor de material.
 *
 * O `SOLICITANTE` não tem `item:read` (não enxerga o catálogo), mas precisa
 * buscar material para montar o pedido — sem isto, o fluxo central de
 * solicitação fica impossível pela interface.
 */
const ITEM_PICKER_PERMISSIONS = [
  "item:read",
  "solicitacao:create",
  "transferencia:create",
  "estoque:entrada",
  "estoque:ajuste",
] as const;

/**
 * Busca por código de barras — chamada pelo leitor da câmera.
 *
 * Devolve `null` quando o código não pertence a nenhum material: não é erro, é o
 * caso normal da doca com produto novo, e o seletor oferece criar o material ali
 * mesmo em vez de mandar o usuário para outra tela.
 */
export async function buscarPorCodigoBarrasAction(barcode: string) {
  return runAction(async () => {
    await requireAnyPermission(ITEM_PICKER_PERMISSIONS);

    const item = await findItemByBarcode(barcode);

    return actionSuccess(item);
  });
}

/** Autocomplete de material. */
export async function buscarItensAction(term: string) {
  return runAction(async () => {
    await requireAnyPermission(ITEM_PICKER_PERMISSIONS);

    const items = await searchItems(term);

    return actionSuccess(items);
  });
}

/**
 * Cadastro rápido de material, direto do leitor da doca.
 *
 * Só o estritamente necessário: nome, unidade e o código de barras que acabou de
 * ser lido. Categoria, SKU, preço e controles saem em "Geral" e nos padrões, e
 * continuam editáveis depois na tela do material.
 */
export async function criarItemRapidoAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<ItemPickOption>> {
  return runAction(async () => {
    const context = await requirePermission("item:create");

    const values = formDataToValues(formData);

    const parsed = itemQuickSchema.safeParse({
      name: readText(values, "name"),
      unitId: readText(values, "unitId"),
      barcode: readText(values, "barcode"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const created = await createItem(context, parsed.data, metadata);

    const option = await getItemPickOption(created.id);

    // Sem isto a linha do documento ficaria sem material e o lançamento quebraria.
    if (!option) throw new NotFoundError("Material");

    revalidatePath("/catalogo/itens");

    return actionSuccess(option, `${option.name} cadastrado.`);
  });
}
