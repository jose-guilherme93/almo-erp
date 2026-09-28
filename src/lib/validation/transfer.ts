import { z } from "zod";

/** Validação do fluxo de transferência entre unidades. */

export const transferPrioritySchema = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);

export const transferLineSchema = z.object({
  itemId: z.string().trim().min(1, "Selecione o material."),
  quantity: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, "Informe uma quantidade válida.")
    .refine((value) => Number(value) > 0, "A quantidade precisa ser maior que zero."),
  notes: z.string().trim().max(200).optional(),
});

export const transferCreateSchema = z
  .object({
    originBranchId: z.string().trim().min(1, "Selecione a unidade de origem."),
    destinationBranchId: z.string().trim().min(1, "Selecione a unidade de destino."),
    priority: transferPrioritySchema.default("NORMAL"),
    notes: z.string().trim().max(600).optional(),
    lines: z.array(transferLineSchema).min(1, "Adicione ao menos um material.").max(200),
  })
  .refine((data) => data.originBranchId !== data.destinationBranchId, {
    message: "A origem e o destino precisam ser diferentes.",
    path: ["destinationBranchId"],
  });

export type TransferCreateInput = z.infer<typeof transferCreateSchema>;

export const transferReceiveSchema = z.object({
  transferId: z.string().trim().min(1),
  comment: z.string().trim().max(600).optional(),
  lines: z
    .array(
      z.object({
        lineId: z.string().trim().min(1),
        quantityReceived: z
          .string()
          .trim()
          .regex(/^\d+(\.\d{1,4})?$/, "Quantidade recebida inválida."),
      }),
    )
    .min(1, "Informe a quantidade recebida."),
});

export type TransferReceiveInput = z.infer<typeof transferReceiveSchema>;
