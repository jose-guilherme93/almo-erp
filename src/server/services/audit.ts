import type { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { APP_VERSION } from "@/lib/version";

const log = logger.with({ service: "audit" });

export type AuditInput = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  branchId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
};

/** Colunas que nunca devem aparecer no diff de auditoria. */
const REDACTED_KEYS = new Set(["token", "password", "secret", "signatureUrl"]);

function sanitize(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;

  const json = JSON.parse(
    JSON.stringify(value, (key, item: unknown) => {
      if (REDACTED_KEYS.has(key)) return "[omitido]";
      // Decimal do Prisma vira string legível no log.
      if (
        typeof item === "object" &&
        item !== null &&
        "toString" in item &&
        "s" in item &&
        "e" in item &&
        "d" in item
      ) {
        return item.toString();
      }
      return item;
    }),
  ) as Prisma.InputJsonValue;

  return json;
}

/**
 * Registra uma ação de escrita na trilha de auditoria.
 *
 * Aceita um `tx` opcional para ser chamado **dentro** da transação da ação —
 * assim a auditoria e a mudança são atômicas.
 *
 * A gravação é best-effort: falhar na auditoria não pode derrubar a operação
 * do almoxarifado, então o erro é logado e engolido.
 */
export async function writeAuditLog(
  input: AuditInput,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;

  try {
    await client.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        branchId: input.branchId ?? null,
        before: sanitize(input.before),
        after: sanitize(input.after),
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        appVersion: APP_VERSION,
      },
    });
  } catch (error) {
    log.error("falha ao gravar auditoria", {
      error,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
    });
  }
}

/** Histórico de uma entidade, do mais recente para o mais antigo. */
export async function listAuditTrail(options: {
  entityType: string;
  entityId: string;
  limit?: number;
}) {
  return prisma.auditLog.findMany({
    where: { entityType: options.entityType, entityId: options.entityId },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 50,
    select: {
      id: true,
      action: true,
      createdAt: true,
      before: true,
      after: true,
      actor: { select: { id: true, name: true, email: true } },
    },
  });
}

/** Listagem paginada de auditoria com filtros (FASE 13). */
export async function listAuditLogs(options: {
  branchIds?: string[];
  actorId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));

  const where: Prisma.AuditLogWhereInput = {
    ...(options.branchIds ? { branchId: { in: options.branchIds } } : {}),
    ...(options.actorId ? { actorId: options.actorId } : {}),
    ...(options.entityType ? { entityType: options.entityType } : {}),
    ...(options.entityId ? { entityId: options.entityId } : {}),
    ...(options.action ? { action: { contains: options.action } } : {}),
    ...(options.from || options.to
      ? {
          createdAt: {
            ...(options.from ? { gte: options.from } : {}),
            ...(options.to ? { lte: options.to } : {}),
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        branchId: true,
        before: true,
        after: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
