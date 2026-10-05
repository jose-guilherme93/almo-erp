import { z } from "zod";

/**
 * Consulta pública de CNPJ (BrasilAPI).
 *
 * O navegador chama a nossa rota `/api/cnpj/[cnpj]`; é ela que fala com a
 * BrasilAPI (o CSP do projeto restringe `connect-src` a `self`). Este módulo
 * guarda só o formato de saída e a tradução do payload da BrasilAPI — é puro,
 * para ser testado sem rede.
 */

export const cnpjLookupSchema = z.object({
  cnpj: z.string().length(14),
  legalName: z.string().min(1),
  tradeName: z.string().nullable(),
  cnae: z.string().nullable(),
  zipCode: z.string().nullable(),
  street: z.string().nullable(),
  number: z.string().nullable(),
  complement: z.string().nullable(),
  district: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
});

export type CnpjLookup = z.infer<typeof cnpjLookupSchema>;

/** Resposta da rota `/api/cnpj/[cnpj]` (sucesso ou erro com mensagem pronta). */
export const cnpjLookupResponseSchema = z.object({
  ok: z.boolean(),
  data: cnpjLookupSchema.optional(),
  error: z.string().optional(),
});

export type CnpjLookupResponse = z.infer<typeof cnpjLookupResponseSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function readDigits(value: unknown): string | null {
  const text = readText(value);
  if (!text) return null;

  const digits = text.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * Traduz o payload da BrasilAPI (`/api/cnpj/v1/{cnpj}`) para o nosso formato.
 *
 * Devolve `null` quando o payload não tem o mínimo (CNPJ e razão social): a
 * consulta pode ter respondido 200, mas não serve para preencher o cadastro.
 */
export function mapBrasilApiCnpj(payload: unknown): CnpjLookup | null {
  if (!isRecord(payload)) return null;

  const cnpj = readDigits(payload["cnpj"]);
  const legalName = readText(payload["razao_social"]);

  if (!cnpj || !legalName) return null;

  const state = readText(payload["uf"]);

  return {
    cnpj,
    legalName,
    tradeName: readText(payload["nome_fantasia"]),
    cnae: readDigits(payload["cnae_fiscal"]) ?? readDigits(payload["codigo_cnae"]),
    zipCode: readDigits(payload["cep"]),
    street: readText(payload["logradouro"]),
    number: readText(payload["numero"]),
    complement: readText(payload["complemento"]),
    district: readText(payload["bairro"]),
    city: readText(payload["municipio"]),
    state: state ? state.toUpperCase().slice(0, 2) : null,
  };
}
