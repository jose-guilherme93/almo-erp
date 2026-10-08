import { z } from "zod";

/** Validação do formulário de movimentação de estoque (entrada e ajuste). */

export const stockDocumentLineSchema = z.object({
  itemId: z.string().trim().min(1, "Selecione o material."),
  /**
   * Quantidade em texto para preservar a precisão: converter para `number`
   * perderia casas decimais antes de virar `Decimal` (AGENTS.md §3.5).
   */
  quantity: z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d{1,4})?$/, "Informe uma quantidade válida (até 4 casas decimais).")
    .refine((value) => Number(value) !== 0, "A quantidade não pode ser zero."),
  unitCost: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, "Informe um custo válido (até 2 casas decimais).")
    .default("0"),
  itemLotId: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value)),
  /** Séries informadas (uma por unidade) na entrada de material com série. */
  serialNumbers: z.array(z.string().trim().min(1).max(120)).max(500).optional(),
});

export type StockDocumentLineInput = z.infer<typeof stockDocumentLineSchema>;

export const stockDocumentInputSchema = z.object({
  branchId: z.string().trim().min(1, "Unidade é obrigatória."),
  type: z.enum([
    "INBOUND",
    "ISSUE",
    "ADJUSTMENT",
    "TRANSFER_OUT",
    "TRANSFER_IN",
    "RETURN",
    "INVENTORY",
  ]),
  storageLocationId: z.string().trim().min(1, "Selecione o local de estoque."),
  date: z.string().trim().optional(),
  notes: z.string().trim().max(600).optional(),
  referenceType: z.string().trim().max(40).optional(),
  referenceId: z.string().trim().max(80).optional(),
  supplierName: z.string().trim().max(160).optional(),
  justification: z.string().trim().max(600).optional(),
  lines: z
    .array(stockDocumentLineSchema)
    .min(1, "Adicione ao menos um material.")
    .max(200, "Documento com muitos itens. Divida em mais de um lançamento."),
});

export type StockDocumentInput = z.infer<typeof stockDocumentInputSchema>;
