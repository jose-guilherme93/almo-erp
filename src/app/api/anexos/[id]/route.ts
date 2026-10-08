import { readFile } from "node:fs/promises";

import { NextResponse, type NextRequest } from "next/server";

import { getAuthContext } from "@/server/auth/context";
import { dispatchIncident } from "@/server/services/observability";
import { absolutePathFor, getAttachmentMetadata } from "@/server/services/attachment";
import { canViewMaintenance } from "@/server/services/maintenance";
import { canViewRequest } from "@/server/services/request";

/**
 * Serve o binário de um anexo.
 *
 * A autorização é a mesma da entidade pai: quem não enxerga a solicitação nem
 * o chamado não recebe a imagem, mesmo conhecendo o id.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await getAuthContext();

  if (!context) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }

  const { id } = await params;

  const attachment = await getAttachmentMetadata(id).catch(() => null);

  if (!attachment) {
    return NextResponse.json({ error: "Anexo não encontrado." }, { status: 404 });
  }

  const allowed = attachment.requestId
    ? await canViewRequest(context, attachment.requestId)
    : attachment.maintenanceRequestId
      ? await canViewMaintenance(context, attachment.maintenanceRequestId)
      : false;

  if (!allowed) {
    return NextResponse.json({ error: "Sem acesso a este anexo." }, { status: 403 });
  }

  try {
    const buffer = await readFile(absolutePathFor(attachment.storageKey));

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.fileName)}"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    // Arquivo ausente é resposta prevista (404). Falha real de I/O — permissão,
    // disco cheio — é defeito e precisa aparecer em `/admin/erros`.
    if (!isMissingFile(error)) {
      await dispatchIncident({
        kind: "route",
        routePath: "/api/anexos/[id]",
        method: "GET",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? (error.stack ?? null) : null,
        context: { source: "api/anexos" },
      });
    }

    return NextResponse.json({ error: "Arquivo indisponível." }, { status: 404 });
  }
}

/** `ENOENT` é "o arquivo não existe" — não é defeito, é o 404 esperado. */
function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
