import { mapBrasilApiCnpj, type CnpjLookup } from "@/lib/cnpj";
import { env } from "@/lib/env";
import { AppError, BusinessRuleError, NotFoundError } from "@/lib/errors";

/**
 * Consulta um CNPJ na base pública (BrasilAPI por padrão).
 *
 * Fica no servidor porque o CSP do projeto só permite `connect-src 'self'`.
 * O timeout é curto de propósito: é um preenchimento auxiliar e não pode travar
 * o cadastro quando a API externa estiver lenta.
 */

const DEFAULT_BASE_URL = "https://brasilapi.com.br/api/cnpj/v1";
const TIMEOUT_MS = 8_000;

export async function lookupCnpj(cnpj: string): Promise<CnpjLookup> {
  const baseUrl = env.CNPJ_API_URL ?? DEFAULT_BASE_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/${cnpj}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    if (response.status === 404) {
      throw new NotFoundError("CNPJ");
    }

    if (!response.ok) {
      throw new BusinessRuleError(
        "A consulta de CNPJ está indisponível no momento. Preencha os dados manualmente.",
      );
    }

    const payload: unknown = await response.json();
    const mapped = mapBrasilApiCnpj(payload);

    if (!mapped) {
      throw new BusinessRuleError(
        "A consulta não retornou dados utilizáveis. Preencha os dados manualmente.",
      );
    }

    return mapped;
  } catch (error) {
    if (error instanceof AppError) throw error;

    throw new BusinessRuleError(
      "Não foi possível consultar o CNPJ agora. Preencha os dados manualmente.",
    );
  } finally {
    clearTimeout(timer);
  }
}
