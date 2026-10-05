import { NextResponse, type NextRequest } from "next/server";

import { isAppError } from "@/lib/errors";
import { onlyDigits } from "@/lib/format";
import { isValidCnpj } from "@/lib/validation/br";
import { getAuthContext } from "@/server/auth/context";
import { lookupCnpj } from "@/server/services/cnpj";

/**
 * Consulta de CNPJ para o cadastro de unidade.
 *
 * O navegador não fala com a BrasilAPI direto (o CSP restringe `connect-src` a
 * `self`): ele chama esta rota, que exige a mesma permissão do cadastro de
 * filial e traduz o payload antes de devolver.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ cnpj: string }> },
) {
  const context = await getAuthContext();

  if (!context) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }

  if (!context.hasPermission("filial:create") && !context.hasPermission("filial:manage")) {
    return NextResponse.json({ error: "Sem permissão para consultar CNPJ." }, { status: 403 });
  }

  const { cnpj } = await params;
  const digits = onlyDigits(cnpj);

  if (!isValidCnpj(digits)) {
    return NextResponse.json({ error: "Informe um CNPJ válido." }, { status: 400 });
  }

  try {
    const data = await lookupCnpj(digits);

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const notFound = isAppError(error) && error.code === "NOT_FOUND";
    const message = isAppError(error) ? error.userMessage : "Não foi possível consultar o CNPJ.";

    return NextResponse.json({ ok: false, error: message }, { status: notFound ? 404 : 502 });
  }
}
