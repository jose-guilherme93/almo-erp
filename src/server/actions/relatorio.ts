"use server";

import { redirect } from "next/navigation";

import { actionSuccess, runAction, type ActionResult } from "@/lib/action-result";
import { PERIOD_PRESETS, resolvePreset } from "@/lib/csv";
import { consolidateReportSchema, driveExportSchema } from "@/lib/validation/report";
import {
  formDataToValues,
  readText,
  requestMetadata,
  validationFailure,
} from "@/server/actions/helpers";
import { requirePermission } from "@/server/auth/guards";
import { buildScope, isReportId, runReport } from "@/server/services/reports";
import { consolidateReport, recordReportExport } from "@/server/services/reports/snapshot";

/**
 * Consolidação e exportação de relatórios.
 *
 * Consolidar gera um snapshot imutável (com hash) e registra a saída. O
 * download CSV e a impressão/PDF passam por aqui; o upload ao Drive registra a
 * exportação depois que o navegador conclui o envio.
 */

/** Filial/categoria "todas" viram ausência de filtro. */
function normalizeFilter(value: string | undefined): string | null {
  if (!value || value === "todas") return null;
  return value;
}

export async function consolidarRelatorioAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ snapshotId: string }>> {
  const result = await runAction(async () => {
    const context = await requirePermission("relatorio:read");
    const values = formDataToValues(formData);

    const parsed = consolidateReportSchema.safeParse({
      relatorio: readText(values, "relatorio"),
      periodo: readText(values, "periodo"),
      de: readText(values, "de"),
      ate: readText(values, "ate"),
      filial: readText(values, "filial"),
      categoria: readText(values, "categoria"),
    });

    if (!parsed.success) return validationFailure(parsed.error);

    if (!isReportId(parsed.data.relatorio)) {
      return { ok: false, error: "Relatório não encontrado." };
    }

    const preset = PERIOD_PRESETS.find((entry) => entry.id === parsed.data.periodo);
    const presetPeriod = preset ? resolvePreset(preset.id) : null;

    const scope = buildScope(context, {
      from: presetPeriod?.from ?? parsed.data.de ?? null,
      to: presetPeriod?.to ?? parsed.data.ate ?? null,
      branchId: normalizeFilter(parsed.data.filial),
      categoryId: normalizeFilter(parsed.data.categoria),
    });

    const report = await runReport(parsed.data.relatorio, scope);
    const metadata = await requestMetadata();

    const { snapshotId } = await consolidateReport(context, {
      reportId: parsed.data.relatorio,
      scope,
      result: report,
      format: "PRINT",
      metadata,
    });

    return actionSuccess({ snapshotId }, "Relatório consolidado.");
  });

  if (result.ok) {
    redirect(`/relatorios/consolidados/${result.data.snapshotId}?consolidado=1`);
  }

  return result;
}

/** Registra na auditoria um arquivo enviado ao Google Drive pelo navegador. */
export async function registrarExportacaoDriveAction(input: {
  snapshotId: string;
  fileId: string;
  fileName: string;
  url?: string | null;
}): Promise<ActionResult<{ exportId: string }>> {
  return runAction(async () => {
    const context = await requirePermission("relatorio:read");

    const parsed = driveExportSchema.safeParse({
      snapshotId: input.snapshotId,
      fileId: input.fileId,
      fileName: input.fileName,
      url: input.url ?? undefined,
    });

    if (!parsed.success) return validationFailure(parsed.error);

    const metadata = await requestMetadata();

    const { exportId } = await recordReportExport(context, {
      snapshotId: parsed.data.snapshotId,
      format: "DRIVE",
      destination: parsed.data.fileName,
      destinationUrl: parsed.data.url ?? null,
      metadata,
    });

    return actionSuccess({ exportId }, "Relatório enviado ao Google Drive.");
  });
}
