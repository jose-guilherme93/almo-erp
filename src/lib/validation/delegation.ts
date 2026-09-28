import { z } from "zod";

/** Validação do encaminhamento de etapa entre setores. */

export const delegationCreateSchema = z.object({
  entityType: z.enum(["REQUEST", "MAINTENANCE"], { message: "Demanda inválida." }),
  entityId: z.string().trim().min(1, "Demanda não informada."),
  toSectorId: z.string().trim().min(1, "Escolha o setor de destino."),
  reason: z
    .string()
    .trim()
    .min(5, "Explique o que o setor precisa analisar (mínimo 5 caracteres).")
    .max(600, "O texto é muito longo."),
});

export type DelegationCreateInput = z.infer<typeof delegationCreateSchema>;

export const delegationIdSchema = z.object({
  delegationId: z.string().trim().min(1, "Etapa não informada."),
});

export const delegationProgressSchema = z.object({
  delegationId: z.string().trim().min(1),
  comment: z.string().trim().min(5, "Descreva o andamento.").max(600),
});

export const delegationCompleteSchema = z.object({
  delegationId: z.string().trim().min(1),
  report: z
    .string()
    .trim()
    .min(5, "Descreva o laudo da análise (mínimo 5 caracteres).")
    .max(2000, "O laudo é muito longo."),
});

export const delegationReturnSchema = z.object({
  delegationId: z.string().trim().min(1),
  comment: z.string().trim().max(600).optional(),
});
