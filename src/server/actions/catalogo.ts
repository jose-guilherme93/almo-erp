"use server";

import { revalidatePath } from "next/cache";

import { actionSuccess, type ActionResult } from "@/lib/action-result";
import { runAction } from "@/server/actions/run";
import {
  categorySchema,
  unitSchema,
  updateCategorySchema,
  updateUnitSchema,
} from "@/lib/validation/catalog";
import { requirePermission } from "@/server/auth/guards";
import {
  formDataToValues,
  readBoolean,
  readText,
  requestMetadata,
  validationFailure,
} from "@/server/actions/helpers";
import {
  createCategory,
  deactivateCategory,
  updateCategory,
} from "@/server/services/catalog/category";
import { createUnit, deactivateUnit, updateUnit } from "@/server/services/catalog/unit";

/* -------------------------------------------------------------------------- */
/* Unidades de medida                                                          */
/* -------------------------------------------------------------------------- */

export async function criarUnidadeMedidaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ unitId: string }>> {
  return runAction(async () => {
    const context = await requirePermission("unidade-medida:manage");
    const values = formDataToValues(formData);

    const parsed = unitSchema.safeParse({
      code: readText(values, "code"),
      name: readText(values, "name"),
      allowsDecimals: readBoolean(values, "allowsDecimals"),
      active: readBoolean(values, "active"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const unit = await createUnit(context, parsed.data, metadata);

    revalidatePath("/catalogo/unidades");

    return actionSuccess({ unitId: unit.id }, "Unidade de medida criada.");
  });
}

export async function atualizarUnidadeMedidaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ unitId: string }>> {
  return runAction(async () => {
    const context = await requirePermission("unidade-medida:manage");
    const values = formDataToValues(formData);

    const parsed = updateUnitSchema.safeParse({
      unitId: readText(values, "unitId"),
      code: readText(values, "code"),
      name: readText(values, "name"),
      allowsDecimals: readBoolean(values, "allowsDecimals"),
      active: readBoolean(values, "active"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await updateUnit(context, parsed.data, metadata);

    revalidatePath("/catalogo/unidades");

    return actionSuccess({ unitId: parsed.data.unitId }, "Unidade de medida atualizada.");
  });
}

export async function desativarUnidadeMedidaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("unidade-medida:manage");
    const unitId = readText(formDataToValues(formData), "unitId");

    if (!unitId) return { ok: false, error: "Unidade de medida não informada." };

    const metadata = await requestMetadata();
    await deactivateUnit(context, unitId, metadata);

    revalidatePath("/catalogo/unidades");

    return actionSuccess(undefined, "Unidade de medida desativada.");
  });
}

/* -------------------------------------------------------------------------- */
/* Categorias                                                                  */
/* -------------------------------------------------------------------------- */

function readCategoryForm(formData: FormData) {
  const values = formDataToValues(formData);

  return {
    code: readText(values, "code"),
    name: readText(values, "name"),
    description: readText(values, "description"),
    parentId: readText(values, "parentId"),
    requiresApproval: readBoolean(values, "requiresApproval"),
    active: readBoolean(values, "active"),
  };
}

export async function criarCategoriaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ categoryId: string }>> {
  return runAction(async () => {
    const context = await requirePermission("categoria:manage");

    const parsed = categorySchema.safeParse(readCategoryForm(formData));

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    const category = await createCategory(context, parsed.data, metadata);

    revalidatePath("/catalogo/categorias");

    return actionSuccess({ categoryId: category.id }, "Categoria criada.");
  });
}

export async function atualizarCategoriaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ categoryId: string }>> {
  return runAction(async () => {
    const context = await requirePermission("categoria:manage");
    const values = formDataToValues(formData);

    const parsed = updateCategorySchema.safeParse({
      ...readCategoryForm(formData),
      categoryId: readText(values, "categoryId"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();
    await updateCategory(context, parsed.data, metadata);

    revalidatePath("/catalogo/categorias");

    return actionSuccess({ categoryId: parsed.data.categoryId }, "Categoria atualizada.");
  });
}

export async function desativarCategoriaAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const context = await requirePermission("categoria:manage");
    const categoryId = readText(formDataToValues(formData), "categoryId");

    if (!categoryId) return { ok: false, error: "Categoria não informada." };

    const metadata = await requestMetadata();
    await deactivateCategory(context, categoryId, metadata);

    revalidatePath("/catalogo/categorias");

    return actionSuccess(undefined, "Categoria desativada.");
  });
}
