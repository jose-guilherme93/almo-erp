import { z } from "zod";

/** Validação do fluxo de solicitação de material. */

export const requestPrioritySchema = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);

export const requestLineSchema = z.object({
  itemId: z.string().trim().min(1, "Selecione o material."),
  quantity: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, "Informe uma quantidade válida.")
    .refine((value) => Number(value) > 0, "A quantidade precisa ser maior que zero."),
  lineNotes: z.string().trim().max(200).optional(),
});

export const requestCreateSchema = z.object({
  branchId: z.string().trim().min(1, "Unidade é obrigatória."),
  priority: requestPrioritySchema.default("NORMAL"),
  neededAt: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : value))
    .refine((value) => value === undefined || !Number.isNaN(new Date(value).getTime()), {
      message: "Data de necessidade inválida.",
    }),
  notes: z.string().trim().max(600).optional(),
  lines: z
    .array(requestLineSchema)
    .min(1, "Adicione ao menos um material.")
    .max(100, "Pedido com muitos itens. Divida em mais de uma solicitação."),
});

export type RequestCreateInput = z.infer<typeof requestCreateSchema>;

export const requestApprovalSchema = z
  .object({
    requestId: z.string().trim().min(1),
    decision: z.enum(["approve", "reject"]).default("approve"),
    comment: z.string().trim().max(600).optional(),
    reason: z.string().trim().max(600).optional(),
    lines: z
      .array(
        z.object({
          lineId: z.string().trim().min(1),
          approvedQuantity: z
            .string()
            .trim()
            .regex(/^\d+(\.\d{1,4})?$/, "Quantidade aprovada inválida."),
          nonApprovalReason: z.string().trim().max(300).optional(),
        }),
      )
      .default([]),
  })
  .refine((data) => data.decision !== "reject" || (data.reason ?? "").trim().length >= 5, {
    message: "Informe o motivo da rejeição.",
    path: ["reason"],
  });

export type RequestApprovalInput = z.infer<typeof requestApprovalSchema>;

export const requestDeliverySchema = z.object({
  requestId: z.string().trim().min(1),
  receivedByName: z
    .string()
    .trim()
    .min(3, "Informe quem recebeu o material (mínimo 3 caracteres).")
    .max(120),
  receivedByDocument: z
    .string()
    .trim()
    .transform((value) => value.replace(/\D+/g, ""))
    .refine(
      (value) => value === "" || value.length === 11 || value.length === 14,
      "Documento deve ter 11 (CPF) ou 14 (CNPJ) dígitos.",
    )
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  notes: z.string().trim().max(600).optional(),
  lines: z
    .array(
      z.object({
        lineId: z.string().trim().min(1),
        deliveredQuantity: z
          .string()
          .trim()
          .regex(/^\d+(\.\d{1,4})?$/, "Quantidade entregue inválida."),
      }),
    )
    .min(1, "Informe a quantidade entregue."),
});

export type RequestDeliveryInput = z.infer<typeof requestDeliverySchema>;
