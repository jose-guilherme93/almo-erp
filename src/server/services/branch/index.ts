import type { Prisma } from "@/generated/prisma/client";
import { BusinessRuleError, ConflictError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import type {
  CreateBranchInput,
  StorageLocationInput,
  UpdateBranchInput,
} from "@/lib/validation/branch";
import { writeAuditLog } from "@/server/services/audit";
import type { AuthContext } from "@/server/auth/context";
import { assertBranchAccess, visibleBranchIds } from "@/server/auth/scope";

/**
 * Serviço de filiais (unidades) e locais de estoque.
 *
 * A matriz é dona do cadastro: quem cria e altera unidade é `filial:manage`.
 * Uma unidade enxerga os próprios dados; a rede enxerga todas.
 */

/** Local de estoque criado junto com a unidade. */
export const DEFAULT_LOCATION_CODE = "ALMOX";
export const DEFAULT_LOCATION_NAME = "Almoxarifado Central";

function branchVisibilityFilter(context: AuthContext): Prisma.BranchWhereInput {
  if (context.isNetworkScope) return {};
  return { id: { in: visibleBranchIds(context) } };
}

export type BranchListFilters = {
  search?: string;
  type?: string | null;
  state?: string | null;
  status?: string | null;
  page?: number;
  pageSize?: number;
};

export async function listBranches(context: AuthContext, filters: BranchListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 20));

  const where: Prisma.BranchWhereInput = {
    ...branchVisibilityFilter(context),
    ...(filters.type ? { type: filters.type as "MATRIX" | "BRANCH" } : {}),
    ...(filters.state ? { state: filters.state } : {}),
    ...(filters.status === "active" ? { active: true } : {}),
    ...(filters.status === "inactive" ? { active: false } : {}),
    ...(filters.search
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" } },
            { code: { contains: filters.search, mode: "insensitive" } },
            { city: { contains: filters.search, mode: "insensitive" } },
            { tradeName: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.branch.findMany({
      where,
      orderBy: [{ type: "asc" }, { code: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        city: true,
        state: true,
        active: true,
        cnpj: true,
        warehouseResponsible: { select: { id: true, name: true } },
        defaultApprover: { select: { id: true, name: true } },
        _count: { select: { storageLocations: true, memberships: true } },
      },
    }),
    prisma.branch.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Filiais ativas para selects, já no escopo do usuário. */
export async function listBranchOptions(context: AuthContext) {
  return prisma.branch.findMany({
    where: { ...branchVisibilityFilter(context), active: true },
    orderBy: [{ type: "asc" }, { code: "asc" }],
    select: { id: true, code: true, name: true, type: true },
  });
}

export async function getBranchDetail(context: AuthContext, branchId: string) {
  assertBranchAccess(context, branchId);

  const branch = await prisma.branch.findFirst({
    where: { id: branchId },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      legalName: true,
      tradeName: true,
      cnpj: true,
      stateRegistration: true,
      cnae: true,
      active: true,
      zipCode: true,
      street: true,
      number: true,
      complement: true,
      district: true,
      city: true,
      state: true,
      country: true,
      latitude: true,
      longitude: true,
      email: true,
      phone: true,
      whatsapp: true,
      legalResponsibleId: true,
      legalResponsibleName: true,
      legalResponsibleDocument: true,
      warehouseResponsibleId: true,
      notificationResponsibleId: true,
      defaultApproverId: true,
      businessHours: true,
      notes: true,
      parentId: true,
      createdAt: true,
      updatedAt: true,
      parent: { select: { id: true, code: true, name: true } },
      warehouseResponsible: { select: { id: true, name: true, email: true } },
      notificationResponsible: { select: { id: true, name: true, email: true } },
      defaultApprover: { select: { id: true, name: true, email: true } },
      legalResponsible: { select: { id: true, name: true, email: true } },
      storageLocations: {
        orderBy: [{ type: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          description: true,
          active: true,
          responsible: { select: { id: true, name: true } },
          _count: { select: { stockLevels: true } },
        },
      },
      memberships: {
        where: { active: true },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          isDefault: true,
          user: { select: { id: true, name: true, email: true, status: true } },
          role: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });

  if (!branch) {
    throw new NotFoundError("Unidade");
  }

  return branch;
}

export async function createBranch(
  context: AuthContext,
  input: CreateBranchInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const [codeTaken, cnpjTaken] = await Promise.all([
    prisma.branch.findUnique({ where: { code: input.code }, select: { id: true } }),
    prisma.branch.findUnique({ where: { cnpj: input.cnpj }, select: { id: true } }),
  ]);

  if (codeTaken) {
    throw new ConflictError(`Já existe uma unidade com o código ${input.code}.`);
  }

  if (cnpjTaken) {
    throw new ConflictError("Já existe uma unidade com este CNPJ.");
  }

  if (input.parentId) {
    const parent = await prisma.branch.findUnique({
      where: { id: input.parentId },
      select: { id: true },
    });

    if (!parent) throw new NotFoundError("Unidade superior");
  }

  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.create({
      data: {
        code: input.code,
        name: input.name,
        type: input.type,
        legalName: input.legalName,
        tradeName: input.tradeName,
        cnpj: input.cnpj,
        stateRegistration: input.stateRegistration,
        cnae: input.cnae,
        active: input.active,
        zipCode: input.zipCode,
        street: input.street,
        number: input.number,
        complement: input.complement,
        district: input.district,
        city: input.city,
        state: input.state,
        country: input.country,
        latitude: input.latitude,
        longitude: input.longitude,
        email: input.email,
        phone: input.phone,
        whatsapp: input.whatsapp,
        legalResponsibleId: input.legalResponsibleId,
        legalResponsibleName: input.legalResponsibleName,
        legalResponsibleDocument: input.legalResponsibleDocument,
        warehouseResponsibleId: input.warehouseResponsibleId,
        notificationResponsibleId: input.notificationResponsibleId,
        defaultApproverId: input.defaultApproverId,
        businessHours: input.businessHours,
        notes: input.notes,
        parentId: input.parentId,
      },
      select: { id: true, code: true, name: true },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "branch.created",
        entityType: "Branch",
        entityId: branch.id,
        branchId: branch.id,
        after: input,
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    // Toda unidade nasce com o almoxarifado. Sem isso, a primeira entrada de
    // estoque morre em "Nenhum local cadastrado" e manda o usuário para uma aba
    // escondida do cadastro da unidade — o caminho inverso do esperado.
    await tx.storageLocation.create({
      data: {
        branchId: branch.id,
        code: DEFAULT_LOCATION_CODE,
        name: DEFAULT_LOCATION_NAME,
        type: "MAIN_WAREHOUSE",
        description: "Local principal de guarda e distribuição de materiais.",
      },
    });

    return branch;
  });
}

export async function updateBranch(
  context: AuthContext,
  input: UpdateBranchInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const current = await getBranchDetail(context, input.branchId);

  if (input.code !== current.code) {
    const taken = await prisma.branch.findUnique({
      where: { code: input.code },
      select: { id: true },
    });

    if (taken && taken.id !== input.branchId) {
      throw new ConflictError(`Já existe uma unidade com o código ${input.code}.`);
    }
  }

  if (input.cnpj && input.cnpj !== current.cnpj) {
    const taken = await prisma.branch.findUnique({
      where: { cnpj: input.cnpj },
      select: { id: true },
    });

    if (taken && taken.id !== input.branchId) {
      throw new ConflictError("Já existe uma unidade com este CNPJ.");
    }
  }

  // Uma unidade não pode ser superior de si mesma.
  if (input.parentId === input.branchId) {
    throw new BusinessRuleError("A unidade não pode ser superior dela mesma.");
  }

  await assertNoHierarchyCycle(input.branchId, input.parentId);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.branch.update({
      where: { id: input.branchId },
      data: {
        code: input.code,
        name: input.name,
        type: input.type,
        legalName: input.legalName,
        tradeName: input.tradeName,
        cnpj: input.cnpj,
        stateRegistration: input.stateRegistration,
        cnae: input.cnae,
        active: input.active,
        zipCode: input.zipCode,
        street: input.street,
        number: input.number,
        complement: input.complement,
        district: input.district,
        city: input.city,
        state: input.state,
        country: input.country,
        latitude: input.latitude,
        longitude: input.longitude,
        email: input.email,
        phone: input.phone,
        whatsapp: input.whatsapp,
        legalResponsibleId: input.legalResponsibleId,
        legalResponsibleName: input.legalResponsibleName,
        legalResponsibleDocument: input.legalResponsibleDocument,
        warehouseResponsibleId: input.warehouseResponsibleId,
        notificationResponsibleId: input.notificationResponsibleId,
        defaultApproverId: input.defaultApproverId,
        businessHours: input.businessHours,
        notes: input.notes,
        parentId: input.parentId,
      },
      select: { id: true, code: true, name: true },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "branch.updated",
        entityType: "Branch",
        entityId: input.branchId,
        branchId: input.branchId,
        before: {
          code: current.code,
          name: current.name,
          cnpj: current.cnpj,
          city: current.city,
          state: current.state,
          active: current.active,
        },
        after: input,
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return updated;
  });
}

/** Rejeita hierarquia cíclica (A → B → A). */
async function assertNoHierarchyCycle(
  branchId: string,
  parentId: string | undefined,
): Promise<void> {
  if (!parentId) return;

  let cursor: string | undefined = parentId;

  for (let depth = 0; depth < 50 && cursor; depth += 1) {
    if (cursor === branchId) {
      throw new BusinessRuleError(
        "Esta hierarquia criaria um ciclo: a unidade ficaria subordinada a ela mesma.",
      );
    }

    const parent: { parentId: string | null } | null = await prisma.branch.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });

    cursor = parent?.parentId ?? undefined;
  }
}

/**
 * Motivos que impedem desativar uma unidade.
 *
 * Desativar com material em trânsito ou inventário aberto deixaria saldo
 * órfão — melhor bloquear e dizer exatamente o que resolver.
 */
export async function listDeactivationBlockers(branchId: string): Promise<string[]> {
  const [inTransit, openInventory, pendingRequests, stockWithBalance] = await Promise.all([
    prisma.transfer.count({
      where: {
        status: { in: ["SENT", "IN_TRANSIT"] },
        OR: [{ originBranchId: branchId }, { destinationBranchId: branchId }],
      },
    }),
    prisma.inventorySession.count({
      where: { branchId, status: { in: ["OPEN", "COUNTING"] } },
    }),
    prisma.request.count({
      where: {
        branchId,
        status: {
          in: ["SUBMITTED", "IN_REVIEW", "APPROVED", "PARTIALLY_APPROVED", "IN_PREPARATION"],
        },
      },
    }),
    prisma.stockLevel.count({ where: { branchId, quantity: { gt: 0 } } }),
  ]);

  const blockers: string[] = [];

  if (inTransit > 0) {
    blockers.push(`${inTransit} transferência(s) em trânsito envolvendo esta unidade`);
  }

  if (openInventory > 0) {
    blockers.push(`${openInventory} inventário(s) em aberto`);
  }

  if (pendingRequests > 0) {
    blockers.push(`${pendingRequests} solicitação(ões) em andamento`);
  }

  if (stockWithBalance > 0) {
    blockers.push(`${stockWithBalance} item(ns) com saldo em estoque`);
  }

  return blockers;
}

export async function deactivateBranch(
  context: AuthContext,
  input: { branchId: string; reason?: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const current = await getBranchDetail(context, input.branchId);

  if (!current.active) {
    throw new BusinessRuleError("Esta unidade já está desativada.");
  }

  if (current.type === "MATRIX") {
    throw new BusinessRuleError(
      "A matriz não pode ser desativada. Defina outra unidade como matriz antes.",
    );
  }

  const blockers = await listDeactivationBlockers(input.branchId);

  if (blockers.length > 0) {
    throw new BusinessRuleError(`Não é possível desativar esta unidade: ${blockers.join("; ")}.`);
  }

  return prisma.$transaction(async (tx) => {
    await tx.branch.update({ where: { id: input.branchId }, data: { active: false } });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "branch.deactivated",
        entityType: "Branch",
        entityId: input.branchId,
        branchId: input.branchId,
        before: { active: true },
        after: { active: false, reason: input.reason ?? null },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}

export async function reactivateBranch(
  context: AuthContext,
  branchId: string,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  assertBranchAccess(context, branchId);

  return prisma.$transaction(async (tx) => {
    await tx.branch.update({ where: { id: branchId }, data: { active: true } });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "branch.reactivated",
        entityType: "Branch",
        entityId: branchId,
        branchId,
        after: { active: true },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Locais de estoque                                                          */
/* -------------------------------------------------------------------------- */

export async function listStorageLocations(context: AuthContext, branchId: string) {
  assertBranchAccess(context, branchId);

  return prisma.storageLocation.findMany({
    where: { branchId },
    orderBy: [{ active: "desc" }, { type: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      description: true,
      active: true,
      responsibleId: true,
      responsible: { select: { id: true, name: true } },
      _count: { select: { stockLevels: true } },
    },
  });
}

export async function createStorageLocation(
  context: AuthContext,
  input: StorageLocationInput,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  assertBranchAccess(context, input.branchId);

  const taken = await prisma.storageLocation.findFirst({
    where: { branchId: input.branchId, code: input.code },
    select: { id: true },
  });

  if (taken) {
    throw new ConflictError(`Já existe um local com o código ${input.code} nesta unidade.`);
  }

  return prisma.$transaction(async (tx) => {
    const location = await tx.storageLocation.create({
      data: {
        branchId: input.branchId,
        code: input.code,
        name: input.name,
        type: input.type,
        description: input.description,
        responsibleId: input.responsibleId,
        active: input.active,
      },
      select: { id: true },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "storage_location.created",
        entityType: "StorageLocation",
        entityId: location.id,
        branchId: input.branchId,
        after: input,
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return location;
  });
}

export async function updateStorageLocation(
  context: AuthContext,
  input: StorageLocationInput & { locationId: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const current = await prisma.storageLocation.findUnique({
    where: { id: input.locationId },
    select: { id: true, branchId: true, code: true, name: true, active: true },
  });

  if (!current) throw new NotFoundError("Local de estoque");

  assertBranchAccess(context, current.branchId);

  return prisma.$transaction(async (tx) => {
    await tx.storageLocation.update({
      where: { id: input.locationId },
      data: {
        code: input.code,
        name: input.name,
        type: input.type,
        description: input.description,
        responsibleId: input.responsibleId,
        active: input.active,
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "storage_location.updated",
        entityType: "StorageLocation",
        entityId: input.locationId,
        branchId: current.branchId,
        before: { code: current.code, name: current.name, active: current.active },
        after: input,
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}

/** Bloqueia desativação de local que ainda tem saldo. */
export async function deactivateStorageLocation(
  context: AuthContext,
  locationId: string,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const location = await prisma.storageLocation.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      branchId: true,
      code: true,
      active: true,
      _count: { select: { stockLevels: true } },
    },
  });

  if (!location) throw new NotFoundError("Local de estoque");

  assertBranchAccess(context, location.branchId);

  const withBalance = await prisma.stockLevel.count({
    where: { storageLocationId: locationId, quantity: { gt: 0 } },
  });

  if (withBalance > 0) {
    throw new BusinessRuleError(
      `Este local tem ${withBalance} item(ns) com saldo. Transfira ou zere o estoque antes de desativar.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.storageLocation.update({ where: { id: locationId }, data: { active: false } });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "storage_location.deactivated",
        entityType: "StorageLocation",
        entityId: locationId,
        branchId: location.branchId,
        after: { active: false },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );
  });
}
