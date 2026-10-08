import { z } from "zod";

/** Validações do patrimônio (FASE 23). */

const optionalNote = z
  .string()
  .trim()
  .max(300)
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : value));

export const assetAssignSchema = z.object({
  assetId: z.string().trim().min(1, "Patrimônio não informado."),
  custodianUserId: z.string().trim().min(1, "Selecione o responsável."),
  notes: optionalNote,
});

export type AssetAssignInput = z.infer<typeof assetAssignSchema>;

export const assetReturnSchema = z.object({
  assetId: z.string().trim().min(1, "Patrimônio não informado."),
  notes: optionalNote,
});

export type AssetReturnInput = z.infer<typeof assetReturnSchema>;

export const assetRetireSchema = z.object({
  assetId: z.string().trim().min(1, "Patrimônio não informado."),
  reason: z.string().trim().min(10, "Explique o motivo da baixa (mínimo 10 caracteres).").max(600),
});

export type AssetRetireInput = z.infer<typeof assetRetireSchema>;
