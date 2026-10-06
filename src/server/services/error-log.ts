import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { APP_VERSION } from "@/lib/version";

const log = logger.with({ service: "error-log" });

/** Stack ocupa espaço e ninguém lê além do topo. */
const STACK_LIMIT = 8_000;
const MESSAGE_LIMIT = 2_000;
const PATH_LIMIT = 300;

/** Chaves que nunca podem entrar num log de erro. */
const REDACTED = /(password|senha|token|secret|authorization|cookie|cpf|cnpj)/i;

/**
 * Ruído que o Next emite e **não** é defeito da aplicação.
 *
 * "The destination stream closed early." acontece quando uma navegação RSC é
 * abandonada — o usuário clica em outro link, ou a aba é fechada, antes do stream
 * terminar. É o comportamento normal de uma navegação cancelada, e chega em
 * volume alto. Sem este filtro a tela vira parede de ruído e o erro que importa
 * some no meio.
 *
 * A lista é curta e específica de propósito: um filtro largo esconderia erro de
 * verdade, que é o oposto do que esta tela existe para fazer.
 */
const IGNORABLE_ERROR = [
  /destination stream closed early/i,
  /^the operation was aborted/i,
  /^request aborted/i,
  /^aborted\b/i,
  /ERR_ABORTED/i,
  /navigation.*aborted/i,
];

/** `true` quando o erro é cancelamento de navegação, e não defeito. */
export function isIgnorableError(message: string): boolean {
  return IGNORABLE_ERROR.some((pattern) => pattern.test(message));
}

/**
 * Rota sem query string.
 *
 * O Next anexa `?_rsc=<hash>` a toda navegação RSC, e o hash muda a cada
 * carregamento. Guardar a query inteira faria a mesma tela virar uma linha
 * diferente a cada visita — que é justamente o oposto de deduplicar.
 */
export function normalizeRoutePath(path: string): string {
  const [routePath = ""] = path.split("?");

  return clip(routePath || path, PATH_LIMIT);
}

export type ServerErrorReport = {
  message: string;
  digest?: string | null;
  stack?: string | null;
  routePath: string;
  routeType: string;
  method?: string | null;
  actorId?: string | null;
  branchId?: string | null;
};

export type RecordResult =
  | { outcome: "created"; id: string; count: number }
  | { outcome: "repeated"; id: string; count: number }
  | { outcome: "skipped" };

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

/** Remove credencial de mensagem e stack antes de persistir. */
function redact(value: string): string {
  return value
    .split("\n")
    .map((line) => (REDACTED.test(line) ? "[linha omitida: pode conter credencial]" : line))
    .join("\n");
}

/**
 * Identidade estável do erro.
 *
 * Só `digest` não serve: o Next reusa o mesmo digest para erros diferentes na
 * mesma render. Só a mensagem também não serve: ela carrega id e timestamp, e
 * cada ocorrência viraria uma linha nova. Os três juntos descrevem *qual* erro,
 * não *quando* ele aconteceu.
 */
export function fingerprintOf(report: ServerErrorReport): string {
  const raw = [
    normalizeRoutePath(report.routePath),
    report.digest ?? "",
    normalizeMessage(report.message),
  ].join("|");

  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

/**
 * Colapsa o que varia entre ocorrências do mesmo erro.
 *
 * Números viram `#` e um trecho de path dinâmico (`/item/abc123`) vira `/item/*`,
 * para que "Erro ao salvar item 1" e "Erro ao salvar item 2" dedupliquem juntos.
 */
export function normalizeMessage(message: string): string {
  return clip(redact(message), MESSAGE_LIMIT)
    .replace(/\b\d{2,}\b/g, "#")
    .replace(/\/[0-9a-z]{6,}(?=\/|$)/gi, "/*");
}

/**
 * Grava o erro, deduplicado.
 *
 * A primeira ocorrência cria a linha; as seguintes só incrementam `count` e
 * movem `lastSeenAt`. Sem isso, um erro em render alcançado por dez usuários
 * criaria dez linhas e a tela viraria parede.
 */
export async function recordServerError(report: ServerErrorReport): Promise<RecordResult> {
  try {
    // Cancelamento de navegação não é defeito: entra no stdout, não na fila.
    if (isIgnorableError(report.message)) {
      log.debug("erro ignorado (navegação abortada)", {
        routePath: report.routePath,
        message: report.message,
      });

      return { outcome: "skipped" };
    }

    const fingerprint = fingerprintOf(report);
    const existing = await prisma.errorLog.findUnique({
      where: { fingerprint },
      select: { id: true, count: true },
    });

    if (existing) {
      const updated = await prisma.errorLog.update({
        where: { id: existing.id },
        data: { count: { increment: 1 }, lastSeenAt: new Date() },
        select: { count: true },
      });

      log.warn("erro repetido", {
        routePath: report.routePath,
        digest: report.digest,
        total: updated.count,
      });

      return { outcome: "repeated", id: existing.id, count: updated.count };
    }

    const created = await prisma.errorLog.create({
      data: {
        fingerprint,
        digest: report.digest ?? null,
        routePath: normalizeRoutePath(report.routePath),
        routeType: report.routeType,
        method: report.method ?? null,
        message: normalizeMessage(report.message),
        stack: report.stack ? clip(redact(report.stack), STACK_LIMIT) : null,
        appVersion: APP_VERSION,
        actorId: report.actorId ?? null,
        branchId: report.branchId ?? null,
      },
      select: { id: true, count: true },
    });

    log.error("erro de servidor", {
      routePath: report.routePath,
      routeType: report.routeType,
      digest: report.digest,
      error: report.message,
    });

    return { outcome: "created", id: created.id, count: created.count };
  } catch (error) {
    // O log de erro nunca pode derrubar quem está sendo atendido: o destino
    // final é o stdout, que não depende do banco.
    log.error("falha ao registrar erro", { error });
    return { outcome: "skipped" };
  }
}

export type ErrorLogFilters = {
  search?: string | null;
  routePath?: string | null;
  onlyOpen?: boolean;
  page?: number;
  pageSize?: number;
};

/** Lista da tela `/admin/erros`, mais recente primeiro. */
export async function listErrorLogs(filters: ErrorLogFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const search = filters.search?.trim() ?? "";

  const where: Prisma.ErrorLogWhereInput = {
    ...(filters.onlyOpen === true ? { resolvedAt: null } : {}),
    ...(filters.routePath
      ? { routePath: { contains: filters.routePath, mode: "insensitive" } }
      : {}),
    ...(search
      ? {
          OR: [
            { message: { contains: search, mode: "insensitive" } },
            { digest: { contains: search } },
            { routePath: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total, openCount] = await Promise.all([
    prisma.errorLog.findMany({
      where,
      orderBy: [{ resolvedAt: { sort: "asc", nulls: "first" } }, { lastSeenAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        digest: true,
        routePath: true,
        routeType: true,
        method: true,
        message: true,
        count: true,
        firstSeenAt: true,
        lastSeenAt: true,
        resolvedAt: true,
        appVersion: true,
        actor: { select: { id: true, name: true } },
      },
    }),
    prisma.errorLog.count({ where }),
    prisma.errorLog.count({ where: { resolvedAt: null } }),
  ]);

  return {
    items,
    total,
    openCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Marca como resolvido — some da frente em vez de ser recontado a cada visita. */
export async function resolveErrorLog(errorLogId: string, resolvedById: string): Promise<void> {
  await prisma.errorLog.updateMany({
    where: { id: errorLogId, resolvedAt: null },
    data: { resolvedAt: new Date(), resolvedById },
  });
}

/** Reabre um erro resolvido: o problema voltou. */
export async function reopenErrorLog(errorLogId: string): Promise<void> {
  await prisma.errorLog.updateMany({
    where: { id: errorLogId, resolvedAt: { not: null } },
    data: { resolvedAt: null, resolvedById: null },
  });
}

/** Rotas com erro aberto, para o filtro da tela. */
export async function listErrorRoutes(): Promise<string[]> {
  const rows = await prisma.errorLog.findMany({
    where: { resolvedAt: null },
    distinct: ["routePath"],
    orderBy: { routePath: "asc" },
    select: { routePath: true },
  });

  return rows.map((row) => row.routePath);
}
