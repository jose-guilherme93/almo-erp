import { z } from "zod";

/** Validação da consolidação e exportação de relatórios. */

export const consolidateReportSchema = z.object({
  relatorio: z.string().trim().min(1, "Relatório não informado."),
  periodo: z.string().trim().optional(),
  de: z.string().trim().optional(),
  ate: z.string().trim().optional(),
  filial: z.string().trim().optional(),
  categoria: z.string().trim().optional(),
});

export type ConsolidateReportInput = z.infer<typeof consolidateReportSchema>;

export const driveExportSchema = z.object({
  snapshotId: z.string().trim().min(1),
  fileId: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(255),
  url: z.string().trim().url().optional(),
});

export type DriveExportInput = z.infer<typeof driveExportSchema>;
