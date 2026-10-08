import type { Prisma } from "@/generated/prisma/client";
import type { AssetStatus } from "@/generated/prisma/enums";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import type { AuthContext } from "@/server/auth/context";
import { assertBranchAccess, branchFilter } from "@/server/auth/scope";
import { notify } from "@/server/services/notification";
import { writeAuditLog } from "@/server/services/audit";
import { currentAssetSequence, formatAssetTag } from "@/server/services/patrimonio/tag";
import { assertAssetTransition } from "@/server/services/patrimonio/transitions";

/**
 * Serviço de patrimônio (FASE 23).
 *
 * O bem nasce na entrada de material com número de série, tem **dono** (pessoa;
 * sem responsável, o Almoxarifado) e **histórico** append-only. Toda query é
 * filtrada por filial (AGENTS.md §3.2) e nenhuma transição mexe em `StockLevel`:
 * posse não é saída de estoque (FASE 23, regra 4).
 */

export type AssetListFilters = {
  search?: string;
  status?: string;
  /** `"none"` = sem responsável (Almoxarifado); `userId` = daquela pessoa. */
  custodian?: string;
  branchId?: string | null;
  page?: number;
  pageSize?: number;
};

const ASSET_STATUSES: readonly AssetStatus[] = ["IN_STOCK", "IN_USE", "IN_MAINTENANCE", "RETIRED"];

function readStatus(status: string | undefined): AssetStatus | undefined {
  return ASSET_STATUSES.find((value) => value === status);
}

const ASSET_SELECT = {
  id: true,
  tag: true,
  serialNumber: true,
  status: true,
  acquiredAt: true,
  retiredAt: true,
  notes: true,
  createdAt: true,
  branch: { select: { id: true, code: true, name: true } },
  item: { select: { id: true, code: true, name: true, unit: { select: { code: true } } } },
  custodian: { select: { id: true, name: true } },
  storageLocation: { select: { id: true, code: true, name: true } },
} satisfies Prisma.AssetSelect;

export type AssetListRow = Prisma.AssetGetPayload<{ select: typeof ASSET_SELECT }>;

export async function listAssets(context: AuthContext, filters: AssetListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const search = filters.search?.trim();

  const where: Prisma.AssetWhereInput = {
    ...branchFilter(context, { branchId: filters.branchId }),
    ...(readStatus(filters.status) ? { status: readStatus(filters.status) } : {}),
    ...(filters.custodian === "none"
      ? { custodianUserId: null }
      : filters.custodian
        ? { custodianUserId: filters.custodian }
        : {}),
    ...(search
      ? {
          OR: [
            { tag: { contains: search, mode: "insensitive" } },
            { serialNumber: { contains: search, mode: "insensitive" } },
            { item: { name: { contains: search, mode: "insensitive" } } },
            { item: { code: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      orderBy: { tag: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: ASSET_SELECT,
    }),
    prisma.asset.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Bens sem responsável (dono = Almoxarifado) no escopo — usado no filtro e nos KPIs. */
export async function countAssetsWithoutCustodian(
  context: AuthContext,
  branchId?: string | null,
): Promise<number> {
  return prisma.asset.count({
    where: {
      ...branchFilter(context, { branchId }),
      custodianUserId: null,
      status: { not: "RETIRED" },
    },
  });
}

/**
 * Pessoas que podem ser responsáveis por um bem naquela unidade.
 *
 * Só quem tem vínculo ativo na unidade do bem — não se entrega patrimônio de
 * uma unidade para alguém de outra.
 */
export async function listAssignableUsers(
  context: AuthContext,
  branchId: string,
): Promise<Array<{ id: string; name: string }>> {
  assertBranchAccess(context, branchId);

  const memberships = await prisma.membership.findMany({
    where: { branchId, active: true, user: { status: "ACTIVE", active: true } },
    orderBy: { user: { name: "asc" } },
    select: { user: { select: { id: true, name: true } } },
  });

  const byId = new Map<string, string>();
  for (const membership of memberships) byId.set(membership.user.id, membership.user.name);

  return [...byId].map(([id, name]) => ({ id, name }));
}

export async function getAsset(context: AuthContext, assetId: string) {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, ...branchFilter(context) },
    select: {
      ...ASSET_SELECT,
      events: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          fromStatus: true,
          toStatus: true,
          notes: true,
          createdAt: true,
          actor: { select: { name: true } },
          fromCustodian: { select: { name: true } },
          toCustodian: { select: { name: true } },
        },
      },
    },
  });

  if (!asset) throw new NotFoundError("Patrimônio");
  return asset;
}

/** Um bem do escopo, com o mínimo para decidir a transição. */
type LockedAsset = {
  id: string;
  tag: string;
  branchId: string;
  status: AssetStatus;
  custodianUserId: string | null;
  itemName: string;
  serialNumber: string | null;
};

async function lockedAsset(
  tx: Prisma.TransactionClient,
  context: AuthContext,
  assetId: string,
): Promise<LockedAsset> {
  const asset = await tx.asset.findFirst({
    where: { id: assetId, ...branchFilter(context) },
    select: {
      id: true,
      tag: true,
      branchId: true,
      status: true,
      custodianUserId: true,
      serialNumber: true,
      item: { select: { name: true } },
    },
  });

  if (!asset) throw new NotFoundError("Patrimônio");

  return {
    id: asset.id,
    tag: asset.tag,
    branchId: asset.branchId,
    status: asset.status,
    custodianUserId: asset.custodianUserId,
    itemName: asset.item.name,
    serialNumber: asset.serialNumber,
  };
}

export async function assignAsset(
  context: AuthContext,
  input: { assetId: string; custodianUserId: string; notes?: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const asset = await lockedAsset(tx, context, input.assetId);

    assertAssetTransition(asset.status, "IN_USE");

    // O responsável precisa ter vínculo ativo na unidade do bem: não se entrega
    // patrimônio de uma unidade para alguém de outra.
    const membership = await tx.membership.findFirst({
      where: {
        userId: input.custodianUserId,
        branchId: asset.branchId,
        active: true,
        user: { status: "ACTIVE", active: true },
      },
      select: { id: true },
    });

    if (!membership) {
      throw new BusinessRuleError(
        "O responsável precisa ser um usuário ativo com vínculo nesta unidade.",
      );
    }

    const updated = await tx.asset.update({
      where: { id: asset.id },
      data: { custodianUserId: input.custodianUserId, status: "IN_USE", storageLocationId: null },
      select: { id: true, tag: true, status: true },
    });

    await tx.assetEvent.create({
      data: {
        assetId: asset.id,
        type: "ASSIGNED",
        fromStatus: asset.status,
        toStatus: "IN_USE",
        fromCustodianId: asset.custodianUserId,
        toCustodianId: input.custodianUserId,
        actorId: context.user.id,
        notes: input.notes,
      },
    });

    await notify(tx, {
      type: "ASSET_ASSIGNED",
      actorId: context.user.id,
      branchId: asset.branchId,
      entityType: "Asset",
      entityId: asset.id,
      data: {
        assetId: asset.id,
        tag: asset.tag,
        itemName: asset.itemName,
        serialNumber: asset.serialNumber,
        custodianId: input.custodianUserId,
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "asset.assigned",
        entityType: "Asset",
        entityId: asset.id,
        branchId: asset.branchId,
        before: { status: asset.status, custodianUserId: asset.custodianUserId },
        after: { status: "IN_USE", custodianUserId: input.custodianUserId },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return updated;
  });
}

export async function returnAsset(
  context: AuthContext,
  input: { assetId: string; notes?: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const asset = await lockedAsset(tx, context, input.assetId);

    assertAssetTransition(asset.status, "IN_STOCK");

    const updated = await tx.asset.update({
      where: { id: asset.id },
      data: { custodianUserId: null, status: "IN_STOCK" },
      select: { id: true, tag: true, status: true },
    });

    await tx.assetEvent.create({
      data: {
        assetId: asset.id,
        type: "RETURNED",
        fromStatus: asset.status,
        toStatus: "IN_STOCK",
        fromCustodianId: asset.custodianUserId,
        toCustodianId: null,
        actorId: context.user.id,
        notes: input.notes,
      },
    });

    await notify(tx, {
      type: "ASSET_RETURNED",
      actorId: context.user.id,
      branchId: asset.branchId,
      entityType: "Asset",
      entityId: asset.id,
      data: {
        assetId: asset.id,
        tag: asset.tag,
        itemName: asset.itemName,
        previousCustodianId: asset.custodianUserId,
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "asset.returned",
        entityType: "Asset",
        entityId: asset.id,
        branchId: asset.branchId,
        before: { status: asset.status, custodianUserId: asset.custodianUserId },
        after: { status: "IN_STOCK", custodianUserId: null },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return updated;
  });
}

export async function retireAsset(
  context: AuthContext,
  input: { assetId: string; reason: string },
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  if (input.reason.trim().length < 10) {
    throw new BusinessRuleError("Explique o motivo da baixa (mínimo 10 caracteres).");
  }

  return prisma.$transaction(async (tx) => {
    const asset = await lockedAsset(tx, context, input.assetId);

    assertAssetTransition(asset.status, "RETIRED");

    const updated = await tx.asset.update({
      where: { id: asset.id },
      data: {
        status: "RETIRED",
        retiredAt: new Date(),
        custodianUserId: null,
      },
      select: { id: true, tag: true, status: true },
    });

    await tx.assetEvent.create({
      data: {
        assetId: asset.id,
        type: "RETIRED",
        fromStatus: asset.status,
        toStatus: "RETIRED",
        fromCustodianId: asset.custodianUserId,
        actorId: context.user.id,
        notes: input.reason,
      },
    });

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "asset.retired",
        entityType: "Asset",
        entityId: asset.id,
        branchId: asset.branchId,
        before: { status: asset.status },
        after: { status: "RETIRED", reason: input.reason },
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return updated;
  });
}

/* -------------------------------------------------------------------------- */
/* Criação a partir da entrada de estoque                                      */
/* -------------------------------------------------------------------------- */

export type InboundAssetLine = {
  itemId: string;
  /** Quantidade assinada da linha (positiva na entrada). */
  quantity: Prisma.Decimal;
  serialNumbers?: readonly string[];
};

/**
 * Cria os bens de patrimônio a partir das linhas de um documento de estoque.
 *
 * Roda **dentro da transação** do documento. Material com série e `trackAsAsset`
 * exige uma série por unidade na entrada; material sem série (ou marcado como
 * "não é patrimônio") não gera bem. A posse não entra aqui: o bem nasce
 * `IN_STOCK`, no Almoxarifado.
 */
export async function createAssetsFromStockLines(
  tx: Prisma.TransactionClient,
  input: {
    branchId: string;
    storageLocationId: string;
    actorId: string;
    type: string;
    lines: readonly InboundAssetLine[];
  },
): Promise<number> {
  const requireSerials = input.type === "INBOUND";

  const itemIds = [...new Set(input.lines.map((line) => line.itemId))];
  if (itemIds.length === 0) return 0;

  const items = await tx.item.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true, hasSerialControl: true, trackAsAsset: true },
  });
  const itemById = new Map(items.map((item) => [item.id, item]));

  let sequence = await currentAssetSequence(tx);
  let created = 0;

  for (const line of input.lines) {
    const item = itemById.get(line.itemId);
    if (!item) continue;

    const serials = (line.serialNumbers ?? [])
      .map((serial) => serial.trim())
      .filter((serial) => serial.length > 0);

    if (!item.hasSerialControl || !item.trackAsAsset) {
      if (serials.length > 0) {
        throw new BusinessRuleError(
          `O material ${item.name} não é um patrimônio rastreável. Remova as séries informadas.`,
        );
      }
      continue;
    }

    if (serials.length === 0) {
      if (requireSerials && line.quantity.isPositive()) {
        throw new BusinessRuleError(
          `O material ${item.name} é patrimônio: informe uma série para cada unidade recebida.`,
        );
      }
      continue;
    }

    if (!line.quantity.isInteger() || serials.length !== line.quantity.toNumber()) {
      throw new BusinessRuleError(
        `O material ${item.name} exige uma série por unidade: ${serials.length} série(s) para ${line.quantity.toString()} unidade(s).`,
      );
    }

    if (new Set(serials).size !== serials.length) {
      throw new BusinessRuleError(`Há número de série repetido na entrada de ${item.name}.`);
    }

    for (const serialNumber of serials) {
      sequence += 1;

      const asset = await tx.asset.create({
        data: {
          tag: formatAssetTag(sequence),
          itemId: line.itemId,
          serialNumber,
          branchId: input.branchId,
          storageLocationId: input.storageLocationId,
          status: "IN_STOCK",
          createdById: input.actorId,
        },
        select: { id: true },
      });

      await tx.assetEvent.create({
        data: {
          assetId: asset.id,
          type: "CREATED",
          toStatus: "IN_STOCK",
          actorId: input.actorId,
          notes: "Bem criado na entrada do material.",
        },
      });

      created += 1;
    }
  }

  return created;
}
