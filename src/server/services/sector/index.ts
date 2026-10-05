import type { Prisma } from "@/generated/prisma/client";
import { SECTOR_CODES } from "@/lib/constants";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";

/**
 * Serviço de setores.
 *
 * Setor é a dimensão que liga o colaborador à demanda e permite encaminhar uma
 * etapa para outro departamento. Os setores de atendimento (almoxarifado,
 * manutenção, TI) são resolvidos por `code`, nunca por nome digitado.
 */

export type SectorOption = {
  id: string;
  code: string;
  name: string;
  kind: "REQUESTER" | "SERVICE" | "BOTH";
};

export async function listActiveSectors(): Promise<SectorOption[]> {
  return prisma.sector.findMany({
    where: { active: true },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, kind: true },
  });
}

export async function getSectorByCode(
  code: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ id: string; code: string; name: string } | null> {
  return client.sector.findUnique({
    where: { code },
    select: { id: true, code: true, name: true },
  });
}

/** Setor de atendimento padrão do almoxarifado. */
export async function getAlmoxarifadoSectorId(
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string | null> {
  const sector = await getSectorByCode(SECTOR_CODES.ALMOXARIFADO, client);
  return sector?.id ?? null;
}

/**
 * Resolve o setor de atendimento de um chamado a partir da categoria.
 *
 * A TI é o único caso em que a categoria aponta para um setor diferente do de
 * manutenção; qualquer outra categoria fica com a manutenção.
 */
export async function getServiceSectorForCategory(
  category: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<string | null> {
  if (category === "IT") {
    const ti = await getSectorByCode(SECTOR_CODES.TI, client);
    return ti?.id ?? null;
  }

  const manutencao = await getSectorByCode(SECTOR_CODES.MANUTENCAO, client);
  return manutencao?.id ?? null;
}

export async function getSectorOrThrow(sectorId: string): Promise<SectorOption> {
  const sector = await prisma.sector.findUnique({
    where: { id: sectorId },
    select: { id: true, code: true, name: true, kind: true },
  });

  if (!sector) throw new NotFoundError("Setor");

  return sector;
}

/** Valida que o setor existe, está ativo e pode atender demandas. */
export async function assertServiceSector(sectorId: string): Promise<SectorOption> {
  const sector = await prisma.sector.findUnique({
    where: { id: sectorId },
    select: { id: true, code: true, name: true, kind: true, active: true },
  });

  if (!sector || !sector.active) throw new NotFoundError("Setor");

  if (!["SERVICE", "BOTH"].includes(sector.kind)) {
    throw new BusinessRuleError("O setor escolhido não atende demandas.");
  }

  return { id: sector.id, code: sector.code, name: sector.name, kind: sector.kind };
}

export { SECTOR_CODES };
