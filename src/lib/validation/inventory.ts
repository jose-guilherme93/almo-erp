import { z } from "zod";

/** Validação do fluxo de inventário. */

export const inventoryCreateSchema = z.object({
  branchId: z.string().trim().min(1, "Unidade é obrigatória."),
  storageLocationId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value)),
  categoryId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value)),
  onlyWithoutMovementDays: z.coerce
    .number()
    .int()
    .positive("Informe um número de dias maior que zero.")
    .optional(),
  notes: z.string().trim().max(600).optional(),
});

export type InventoryCreateInput = z.infer<typeof inventoryCreateSchema>;

/**
 * Contagem de um item.
 *
 * Campo vazio significa **não contado** — e isso é diferente de zero. A tela
 * deixa isso explícito para ninguém zerar um item por engano.
 */
export const inventoryCountSchema = z.object({
  sessionId: z.string().trim().min(1),
  counts: z
    .array(
      z.object({
        lineId: z.string().trim().min(1),
        countedQuantity: z
          .string()
          .trim()
          .optional()
          .transform((value) => (value === "" || value === undefined ? null : value))
          .refine(
            (value) => value === null || /^\d+(\.\d{1,4})?$/.test(value),
            "Quantidade contada inválida.",
          ),
      }),
    )
    .min(1, "Nenhuma contagem informada."),
});

export type InventoryCountInput = z.infer<typeof inventoryCountSchema>;

export const inventoryAdjustmentSchema = z.object({
  sessionId: z.string().trim().min(1),
  justifications: z
    .array(
      z.object({
        lineId: z.string().trim().min(1),
        justification: z.string().trim().max(300).default(""),
      }),
    )
    .default([]),
});

export type InventoryAdjustmentInput = z.infer<typeof inventoryAdjustmentSchema>;
