import { NextResponse, type NextRequest } from "next/server";

import { csvFileName, toCsv, type CsvValue } from "@/lib/csv";
import { ForbiddenError, isAppError } from "@/lib/errors";
import { requirePermission } from "@/server/auth/guards";
import { getReportSnapshot, recordReportExport } from "@/server/services/reports/snapshot";

/**
 * CSV de um relatório **consolidado**.
 *
 * Sai dos dados congelados do snapshot — não reconsulta o banco. Prova que o
 * relatório consolidado é imutável: meses depois, o arquivo é o mesmo.
 * O parâmetro `auditar=0` (usado pelo envio ao Drive) evita registrar uma
 * descarga intermediária.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let context;

  try {
    context = await requirePermission("relatorio:read");
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.userMessage }, { status: 403 });
    }

    throw error;
  }

  let snapshot: Awaited<ReturnType<typeof getReportSnapshot>>;

  try {
    snapshot = await getReportSnapshot(context, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") {
      return NextResponse.json({ error: error.userMessage }, { status: 404 });
    }

    throw error;
  }

  if (request.nextUrl.searchParams.get("auditar") !== "0") {
    const forwarded = request.headers.get("x-forwarded-for");

    await recordReportExport(context, {
      snapshotId: snapshot.id,
      format: "CSV",
      metadata: {
        ip: forwarded
          ? (forwarded.split(",")[0]?.trim() ?? null)
          : request.headers.get("x-real-ip"),
        userAgent: request.headers.get("user-agent"),
      },
    });
  }

  const csv = toCsv(snapshot.headers as string[], snapshot.rows as CsvValue[][]);

  const fileName = csvFileName({
    report: snapshot.reportId,
    from: snapshot.periodFrom.toISOString().slice(0, 10),
    to: snapshot.periodTo.toISOString().slice(0, 10),
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
