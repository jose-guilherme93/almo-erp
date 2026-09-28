import type { Prisma } from "@/generated/prisma/client";
import { DOCUMENT_PREFIX, REQUEST_NUMBER_PADDING } from "@/lib/constants";

/**
 * Numeração sequencial de documentos por filial.
 *
 * Formato: `MV-2026-000123` (prefixo, ano, sequencial).
 *
 * A serialização é feita travando a linha da filial (`SELECT … FOR UPDATE`):
 * duas entradas simultâneas na mesma unidade não podem receber o mesmo
 * número, e o número não pode ter buraco por corrida.
 */

export type DocumentKind = keyof typeof DOCUMENT_PREFIX;

function formatNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(REQUEST_NUMBER_PADDING, "0")}`;
}

/** Trava a linha da filial, serializando a numeração daquela unidade. */
export async function lockBranchForNumbering(
  tx: Prisma.TransactionClient,
  branchId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM branches WHERE id = ${branchId} FOR UPDATE`;
}

async function nextSequence(
  tx: Prisma.TransactionClient,
  model: "stockDocument" | "transfer" | "request" | "inventorySession" | "maintenanceRequest",
  where: Record<string, unknown>,
  prefix: string,
  year: number,
): Promise<number> {
  const like = `${prefix}-${year}-`;

  // Cada modelo tem seu campo de número; consultamos o maior já emitido.
  const rows = await (
    tx[model] as unknown as {
      findFirst: (args: unknown) => Promise<{ number: string } | null>;
    }
  ).findFirst({
    where: { ...where, number: { startsWith: like } },
    orderBy: { number: "desc" },
    select: { number: true },
  });

  if (!rows) return 1;

  const parsed = Number(rows.number.slice(like.length));

  return Number.isFinite(parsed) ? parsed + 1 : 1;
}

/** Próximo número de documento de estoque de uma unidade. */
export async function nextStockDocumentNumber(
  tx: Prisma.TransactionClient,
  branchId: string,
  date: Date = new Date(),
): Promise<string> {
  await lockBranchForNumbering(tx, branchId);

  const year = date.getFullYear();
  const sequence = await nextSequence(
    tx,
    "stockDocument",
    { branchId },
    DOCUMENT_PREFIX.STOCK,
    year,
  );

  return formatNumber(DOCUMENT_PREFIX.STOCK, year, sequence);
}

/** Próximo número de transferência (sequência da unidade de origem). */
export async function nextTransferNumber(
  tx: Prisma.TransactionClient,
  originBranchId: string,
  date: Date = new Date(),
): Promise<string> {
  await lockBranchForNumbering(tx, originBranchId);

  const year = date.getFullYear();
  const sequence = await nextSequence(
    tx,
    "transfer",
    { originBranchId },
    DOCUMENT_PREFIX.TRANSFER,
    year,
  );

  return formatNumber(DOCUMENT_PREFIX.TRANSFER, year, sequence);
}

/** Próximo número de solicitação. */
export async function nextRequestNumber(
  tx: Prisma.TransactionClient,
  branchId: string,
  date: Date = new Date(),
): Promise<string> {
  await lockBranchForNumbering(tx, branchId);

  const year = date.getFullYear();
  const sequence = await nextSequence(tx, "request", { branchId }, DOCUMENT_PREFIX.REQUEST, year);

  return formatNumber(DOCUMENT_PREFIX.REQUEST, year, sequence);
}

/** Próximo número de chamado de reparo. */
export async function nextMaintenanceNumber(
  tx: Prisma.TransactionClient,
  branchId: string,
  date: Date = new Date(),
): Promise<string> {
  await lockBranchForNumbering(tx, branchId);

  const year = date.getFullYear();
  const sequence = await nextSequence(
    tx,
    "maintenanceRequest",
    { branchId },
    DOCUMENT_PREFIX.MAINTENANCE,
    year,
  );

  return formatNumber(DOCUMENT_PREFIX.MAINTENANCE, year, sequence);
}

/** Próximo número de inventário. */
export async function nextInventoryNumber(
  tx: Prisma.TransactionClient,
  branchId: string,
  date: Date = new Date(),
): Promise<string> {
  await lockBranchForNumbering(tx, branchId);

  const year = date.getFullYear();
  const sequence = await nextSequence(
    tx,
    "inventorySession",
    { branchId },
    DOCUMENT_PREFIX.INVENTORY,
    year,
  );

  return formatNumber(DOCUMENT_PREFIX.INVENTORY, year, sequence);
}

/** Exposto para teste: formatação isolada da persistência. */
export const __testing = { formatNumber };
