import { z } from "zod";

import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/server/services/audit";
import type { AuthContext } from "@/server/auth/context";

/**
 * Configurações do sistema.
 *
 * Parâmetros operacionais que o administrador ajusta sem deploy: SLA de
 * aprovação, janela de deduplicação de alerta, contato exibido nas telas de
 * erro e limite para aprovação da matriz.
 */

export const CONFIG_DEFINITIONS = [
  {
    key: "app.name",
    label: "Nome do sistema",
    description: "Exibido no título das páginas e no comprovante de entrega.",
    type: "string" as const,
  },
  {
    key: "email.contato",
    label: "E-mail de contato",
    description: "Mostrado nas telas de acesso negado e de erro.",
    type: "string" as const,
  },
  {
    key: "sla.approvalHours",
    label: "SLA de aprovação (horas)",
    description:
      "Depois desse tempo, a solicitação é marcada como SLA em risco na fila e no dashboard.",
    type: "number" as const,
    min: 1,
    max: 720,
  },
  {
    key: "stock.belowMinDedupDays",
    label: "Deduplicação do alerta de mínimo (dias)",
    description:
      "Janela em que o mesmo alerta de estoque abaixo do mínimo não é repetido para o mesmo usuário.",
    type: "number" as const,
    min: 1,
    max: 90,
  },
  {
    key: "request.matrixApprovalThreshold",
    label: "Limite para aprovação da matriz (R$)",
    description:
      "Valor estimado a partir do qual a solicitação também precisa de aprovação da matriz.",
    type: "number" as const,
    min: 0,
    max: 1_000_000,
  },
  {
    key: "auth.localLogin.enabled",
    label: "Login local (e-mail e senha)",
    description:
      "Permite entrar com e-mail e senha, sem Google. O administrador cria a conta e define a senha.",
    type: "boolean" as const,
  },
  {
    key: "auth.google.enabled",
    label: "Login com Google",
    description:
      'Mostra o botão "Entrar com Google". Exige AUTH_GOOGLE_ID e AUTH_GOOGLE_SECRET configurados.',
    type: "boolean" as const,
  },
] as const;

export type ConfigKey = (typeof CONFIG_DEFINITIONS)[number]["key"];

export const configValueSchema = z.record(z.string(), z.string());

export async function listConfigs() {
  const stored = await prisma.config.findMany({
    select: {
      key: true,
      value: true,
      description: true,
      updatedAt: true,
      updatedBy: { select: { name: true } },
    },
  });

  const byKey = new Map(stored.map((config) => [config.key, config]));

  return CONFIG_DEFINITIONS.map((definition) => {
    const config = byKey.get(definition.key);

    return {
      key: definition.key,
      label: definition.label,
      description: config?.description ?? definition.description,
      type: definition.type,
      value:
        config?.value === undefined || config?.value === null
          ? ""
          : typeof config.value === "string" || typeof config.value === "number"
            ? String(config.value)
            : JSON.stringify(config.value),
      updatedAt: config?.updatedAt ?? null,
      updatedByName: config?.updatedBy?.name ?? null,
    };
  });
}

/** Lê um valor já tipado — usado pelos serviços que consomem configuração. */
export async function getConfigValue<T = string>(key: string, fallback: T): Promise<T> {
  const config = await prisma.config.findUnique({
    where: { key },
    select: { value: true },
  });

  if (config?.value === undefined || config.value === null) return fallback;

  return config.value as T;
}

/** Lê um número de configuração com fallback seguro. */
export async function getConfigNumber(key: string, fallback: number): Promise<number> {
  const config = await prisma.config.findUnique({
    where: { key },
    select: { value: true },
  });

  const value = config?.value;

  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

/**
 * Lê um liga/desliga (`type: "boolean"`) com fallback.
 *
 * Aceita booleano nativo (como fica no JSON após `updateConfigs`) ou string,
 * porque o valor pode ter sido gravado à mão.
 */
export async function isConfigFlagEnabled(key: string, fallback: boolean): Promise<boolean> {
  const config = await prisma.config.findUnique({
    where: { key },
    select: { value: true },
  });

  const value = config?.value;

  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
  }

  return fallback;
}

export async function updateConfigs(
  context: AuthContext,
  values: Record<string, string>,
  metadata?: { ip?: string | null; userAgent?: string | null },
) {
  const updates: Array<{
    key: string;
    value: string | number | boolean;
    definition: (typeof CONFIG_DEFINITIONS)[number];
  }> = [];

  for (const definition of CONFIG_DEFINITIONS) {
    const raw = values[definition.key];

    if (raw === undefined) continue;

    const trimmed = raw.trim();

    if (definition.type === "boolean") {
      if (trimmed !== "true" && trimmed !== "false") {
        throw new BusinessRuleError(`"${definition.label}" precisa ser "Sim" ou "Não".`);
      }

      updates.push({ key: definition.key, value: trimmed === "true", definition });
      continue;
    }

    if (definition.type === "number") {
      const parsed = Number(trimmed);

      if (!Number.isFinite(parsed)) {
        throw new BusinessRuleError(`"${definition.label}" precisa ser um número.`);
      }

      if ("min" in definition && parsed < definition.min) {
        throw new BusinessRuleError(
          `"${definition.label}" precisa ser no mínimo ${definition.min}.`,
        );
      }

      if ("max" in definition && parsed > definition.max) {
        throw new BusinessRuleError(
          `"${definition.label}" precisa ser no máximo ${definition.max}.`,
        );
      }

      updates.push({ key: definition.key, value: parsed, definition });
      continue;
    }

    if (definition.key === "email.contato" && trimmed.length > 0 && !trimmed.includes("@")) {
      throw new BusinessRuleError('"E-mail de contato" precisa ser um endereço válido.');
    }

    if (trimmed.length === 0) {
      throw new BusinessRuleError(`"${definition.label}" não pode ficar em branco.`);
    }

    updates.push({ key: definition.key, value: trimmed, definition });
  }

  if (updates.length === 0) {
    throw new BusinessRuleError("Nenhuma configuração para salvar.");
  }

  return prisma.$transaction(async (tx) => {
    const before: Record<string, unknown> = {};

    for (const update of updates) {
      const current = await tx.config.findUnique({
        where: { key: update.key },
        select: { value: true },
      });

      before[update.key] = current?.value ?? null;

      await tx.config.upsert({
        where: { key: update.key },
        update: { value: update.value, updatedById: context.user.id },
        create: {
          key: update.key,
          value: update.value,
          description: update.definition.description,
          updatedById: context.user.id,
        },
      });
    }

    await writeAuditLog(
      {
        actorId: context.user.id,
        action: "config.updated",
        entityType: "Config",
        before,
        after: Object.fromEntries(updates.map((update) => [update.key, update.value])),
        ip: metadata?.ip,
        userAgent: metadata?.userAgent,
      },
      tx,
    );

    return { updated: updates.length };
  });
}

/** Auditoria com filtros (FASE 13). */
export async function listAuditEntries(
  context: AuthContext,
  filters: {
    actorId?: string | null;
    entityType?: string | null;
    action?: string | null;
    branchId?: string | null;
    from?: string | null;
    to?: string | null;
    page?: number;
    pageSize?: number;
  },
) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));

  const branchScope = filters.branchId
    ? [filters.branchId]
    : context.isNetworkScope
      ? undefined
      : [...context.branchIds];

  const where = {
    ...(branchScope ? { branchId: { in: branchScope } } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.action
      ? { action: { contains: filters.action, mode: "insensitive" as const } }
      : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: new Date(filters.from) } : {}),
            ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59`) } : {}),
          },
        }
      : {}),
  };

  const [items, total, entityTypes] = await Promise.all([
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
        before: true,
        after: true,
        createdAt: true,
        ip: true,
        appVersion: true,
        actor: { select: { id: true, name: true, email: true } },
        branch: { select: { code: true, name: true } },
      },
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({
      by: ["entityType"],
      orderBy: { entityType: "asc" },
    }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    entityTypes: entityTypes.map((row) => row.entityType),
  };
}

/** Detalhe de um registro de auditoria, para a tela de histórico. */
export async function getAuditEntry(context: AuthContext, entryId: string) {
  const entry = await prisma.auditLog.findFirst({
    where: {
      id: entryId,
      ...(context.isNetworkScope ? {} : { branchId: { in: context.branchIds } }),
    },
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      before: true,
      after: true,
      createdAt: true,
      ip: true,
      userAgent: true,
      appVersion: true,
      actor: { select: { name: true, email: true } },
      branch: { select: { code: true, name: true } },
    },
  });

  if (!entry) throw new NotFoundError("Registro de auditoria");

  return entry;
}
