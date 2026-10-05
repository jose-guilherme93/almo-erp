import { NextResponse, type NextRequest } from "next/server";

import { csvFileName } from "@/lib/csv";
import { ForbiddenError } from "@/lib/errors";
import { requirePermission } from "@/server/auth/guards";
import { buildScope, isReportId, reportToCsv, runReport } from "@/server/services/reports";
import { consolidateReport } from "@/server/services/reports/snapshot";

/**
 * Exportação CSV de um relatório.
 *
 * Rota de servidor (e não Server Action) porque o navegador precisa receber um
 * download com `Content-Disposition` — com Server Action isso exigiria gambiarra.
 *
 * O escopo do usuário é aplicado pelo mesmo `buildScope` da tela: exportar
 * nunca pode vazar mais do que a listagem mostra. Além disso, a exportação
 * **consolida** o relatório (snapshot imutável com hash) e fica na auditoria.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ relatorio: string }> },
) {
  const { relatorio } = await params;

  if (!isReportId(relatorio)) {
    return NextResponse.json({ error: "Relatório não encontrado." }, { status: 404 });
  }

  let context;

  try {
    context = await requirePermission("relatorio:read");
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.userMessage }, { status: 403 });
    }

    throw error;
  }

  const searchParams = request.nextUrl.searchParams;

  const filial = searchParams.get("filial");
  const categoria = searchParams.get("categoria");

  const scope = buildScope(context, {
    from: searchParams.get("de"),
    to: searchParams.get("ate"),
    branchId: filial && filial !== "todas" ? filial : null,
    categoryId: categoria && categoria !== "todas" ? categoria : null,
  });

  const result = await runReport(relatorio, scope);

  const forwarded = request.headers.get("x-forwarded-for");

  await consolidateReport(context, {
    reportId: relatorio,
    scope,
    result,
    format: "CSV",
    metadata: {
      ip: forwarded ? (forwarded.split(",")[0]?.trim() ?? null) : request.headers.get("x-real-ip"),
      userAgent: request.headers.get("user-agent"),
    },
  });

  const csv = reportToCsv(result);

  const fileName = csvFileName({
    report: relatorio,
    from: scope.from.toISOString().slice(0, 10),
    to: scope.to.toISOString().slice(0, 10),
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      // Relatório é dado sensível: não deixar em cache intermediário.
      "Cache-Control": "no-store",
    },
  });
}
