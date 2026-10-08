import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * Etiqueta de patrimônio.
 *
 * Formato único e global (`PAT-000123`), gerado pelo servidor — ninguém digita
 * número de patrimônio, como ninguém digita código de material (FASE 23).
 * Funções puras, testáveis sem banco.
 */

export const ASSET_TAG_PREFIX = "PAT";
const SEQUENCE_LENGTH = 6;

/** Monta a etiqueta a partir do sequencial (ex.: 123 → `PAT-000123`). */
export function formatAssetTag(sequence: number): string {
  return `${ASSET_TAG_PREFIX}-${String(sequence).padStart(SEQUENCE_LENGTH, "0")}`;
}

/**
 * Versão para o olho humano: `PAT-000123` → `PAT 000 123`.
 *
 * O valor gravado continua canônico; isto é só a apresentação na tela.
 */
export function formatAssetTagLabel(tag: string): string {
  const sequence = parseAssetTag(tag);
  if (sequence === null) return tag;

  return `${ASSET_TAG_PREFIX} ${String(sequence)
    .padStart(SEQUENCE_LENGTH, "0")
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;
}

/** Extrai o sequencial de uma etiqueta, ou `null` se o formato não bater. */
export function parseAssetTag(tag: string): number | null {
  const match = /^PAT-(\d+)$/.exec(tag.trim());
  return match ? Number(match[1]) : null;
}

/** Maior sequencial já usado, ou 0 quando não há nenhum bem. */
export async function currentAssetSequence(
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const last = await client.asset.findFirst({
    where: { tag: { startsWith: `${ASSET_TAG_PREFIX}-` } },
    orderBy: { tag: "desc" },
    select: { tag: true },
  });

  return last ? (parseAssetTag(last.tag) ?? 0) : 0;
}

/**
 * Próxima etiqueta livre, olhando o maior código existente.
 *
 * Contar registros faria apagar um bem reaproveitar uma etiqueta já gravada em
 * documento — o mesmo motivo do gerador de SKU.
 */
export async function nextAssetTag(
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string> {
  return formatAssetTag((await currentAssetSequence(client)) + 1);
}
