import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import type { UnitInput } from "@/lib/validation/catalog";
import { writeAuditLog } from "@/server/services/audit";
import type { AuthContext } from "@/server/auth/context";

/** Serviço de unidades de medida. */

export async function listUnits(options?: { search?: string; onlyActive?: boolean }) {
  return prisma.unit.findMany({
    where: {
      ...(options?.onlyActive ? { active: true } : {}),
      ...(options?.search
        ? {
            OR: [
              { code: { contains: options.search, mode: "insensitive" } },
              { name: { contains: options.search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ isSystem: "desc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      allowsDecimals: true,
      isSystem: true,
      active: true,
      _count: { select: { items: true } },
    },
  });
}

export async function createUnit(
  context: AuthContext,
  input: UnitInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const taken = await prisma.unit.findUnique({ where: { code: input.code }, select: { id: true } });

  if (taken) {
    throw new ConflictError(`Já existe uma unidade de medida com o código ${input.code}.`);
  }

  return prisma.$transaction(async (tx) => {
    const unit = await tx.unit.create({
      data: {
        code: input.code,
        name: input.name,
        allowsDecimals: input.allowsDecimals,
        active: input.active,
      },
      select: { id: true, code: true },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "unit.created",
        entityType: "Unit",
        entityId: unit.id,
        after: input,
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return unit;
  });
}

export async function updateUnit(
  context: AuthContext,
  input: UnitInput & { unitId: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const current = await prisma.unit.findUnique({
    where: { id: input.unitId },
    select: { id: true, code: true, name: true, isSystem: true, active: true },
  });

  if (!current) throw new NotFoundError("Unidade de medida");

  // O código de uma unidade de sistema (UN, KG, L…) não muda: ele está
  // impresso em relatórios e referenciado em conversas.
  if (current.isSystem && current.code !== input.code) {
    throw new BusinessRuleError("O código de uma unidade de medida padrão não pode ser alterado.");
  }

  if (current.code !== input.code) {
    const taken = await prisma.unit.findUnique({
      where: { code: input.code },
      select: { id: true },
    });

    if (taken && taken.id !== input.unitId) {
      throw new ConflictError(`Já existe uma unidade de medida com o código ${input.code}.`);
    }
  }

  return prisma.$transaction(async (tx) => {
    await tx.unit.update({
      where: { id: input.unitId },
      data: {
        code: input.code,
        name: input.name,
        allowsDecimals: input.allowsDecimals,
        active: input.active,
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "unit.updated",
        entityType: "Unit",
        entityId: input.unitId,
        before: { code: current.code, name: current.name, active: current.active },
        after: input,
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}

export async function deactivateUnit(
  context: AuthContext,
  unitId: string,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    select: { id: true, code: true, isSystem: true, _count: { select: { items: true } } },
  });

  if (!unit) throw new NotFoundError("Unidade de medida");

  if (unit.isSystem) {
    throw new BusinessRuleError("Unidades de medida padrão não podem ser desativadas.");
  }

  if (unit._count.items > 0) {
    throw new BusinessRuleError(
      `Esta unidade está em uso por ${unit._count.items} material(is). Troque a unidade desses materiais antes de desativar.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.unit.update({ where: { id: unitId }, data: { active: false } });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "unit.deactivated",
        entityType: "Unit",
        entityId: unitId,
        after: { active: false },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}
