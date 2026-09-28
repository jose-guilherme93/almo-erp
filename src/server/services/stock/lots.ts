import { prisma } from "@/lib/db";

/**
 * Lotes válidos por material, para os formulários de movimentação.
 *
 * Devolve um mapa `itemId → lotes`, porque o formulário precisa do lote de
 * cada linha sem fazer uma ida ao servidor por material. Lotes vencidos ficam
 * de fora: o motor de estoque os recusaria de qualquer forma.
 */
export async function listActiveLots(
  branchId: string,
): Promise<Record<string, Array<{ id: string; code: string; expirationDate: string | null }>>> {
  const lots = await prisma.itemLot.findMany({
    where: {
      active: true,
      item: { active: true, controlledByLot: true },
      OR: [{ expirationDate: null }, { expirationDate: { gt: new Date() } }],
    },
    orderBy: [{ expirationDate: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      expirationDate: true,
      itemId: true,
      item: { select: { stockLevels: { where: { branchId }, select: { id: true } } } },
    },
  });

  const result: Record<
    string,
    Array<{ id: string; code: string; expirationDate: string | null }>
  > = {};

  for (const lot of lots) {
    // Só interessa lote de material que já tem (ou terá) saldo nesta unidade.
    const key = lot.itemId;
    const entry = result[key] ?? [];

    entry.push({
      id: lot.id,
      code: lot.code,
      expirationDate: lot.expirationDate
        ? lot.expirationDate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
        : null,
    });

    result[key] = entry;
  }

  return result;
}
