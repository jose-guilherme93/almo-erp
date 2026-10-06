import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";

const log = logger.with({ service: "erro-retencao" });

/**
 * Poda do `ErrorLog`.
 *
 * Uma tabela de erro só é útil enquanto alguém investiga. Deixada sem cuidado,
 * ela cresce sem limite — e num banco de 4 GB numa VPS de 2 vCPU, o espaço
 * gasto com stack de erro é espaço que falta para o ERP funcionar.
 *
 * ## Por que não há cron
 *
 * Poda agendada exigiria um agendador: worker, `cron` do Dokploy, ou uma
 * `--watch` no boot. Nenhum deles vale o custo de operação para "apagar linha
 * velha". O que já existe é o gancho perfeito: o `ErrorLog` é escrito quando
 * **acontece** um erro, e erro é raro em sistema saudável. Então a poda roda
 * junto, no máximo uma vez por hora, por processo.
 *
 * O efeito é o de um cron, e a superfície de operação é zero.
 */

/** Erro resolvido e antigo sai primeiro. Já triado não tem valor de histórico. */
const RESOLVED_AFTER_DAYS = 90;

/**
 * Teto absoluto de linhas.
 *
 * O limite por idade sozinho não segura o pior caso: um laço de erro em
 * produção gera 30 mil linhas em uma hora, todas "novas". O teto corta o
 * excedente mais antigo — as linhas novas é que interessam quando o sistema
 * está quebrando.
 */
const MAX_ROWS = 5_000;

/** Um dia é folga de sobra para uma poda que roda no máximo uma vez por hora. */
const MIN_INTERVAL_MS = 60 * 60 * 1_000;

export type RetentionLimits = {
  resolvedAfterDays?: number;
  maxRows?: number;
};

let lastRunAt = 0;

/** Teste: faz a próxima chamada rodar, sem esperar uma hora. */
export function resetRetentionClock(): void {
  lastRunAt = 0;
}

/**
 * Executa a poda se já passou o intervalo.
 *
 * Nunca lança: quem chama está no meio do tratamento de um erro, e a poda é
 * higiene de armazenamento, não parte do trabalho.
 */
export async function pruneErrorLogsIfDue(now = Date.now()): Promise<void> {
  if (now - lastRunAt < MIN_INTERVAL_MS) return;

  // Marca antes de trabalhar: se a poda falhar, ela não pode passar a rodar a
  // cada erro e virar ela mesma um problema.
  lastRunAt = now;

  try {
    await pruneErrorLogs();
  } catch (error) {
    log.error("falha ao podar logs de erro", { error });
  }
}

/** A poda em si, sem o controle de intervalo. */
export async function pruneErrorLogs(
  limits: RetentionLimits = {},
): Promise<{ removedByAge: number; removedByCap: number; remaining: number }> {
  const resolvedAfterDays = limits.resolvedAfterDays ?? RESOLVED_AFTER_DAYS;
  const maxRows = limits.maxRows ?? MAX_ROWS;
  const cutoff = new Date(Date.now() - resolvedAfterDays * 24 * 60 * 60 * 1_000);

  // `lastSeenAt`, e não `firstSeenAt`: um erro resolvido que **continua
  // voltando** tem o `lastSeenAt` refreshed a cada recorrência, então sobrevive
  // à poda. É o comportamento certo — o defeito ainda está acontecendo, e é
  // justamente esse que alguém precisa ver. Bate também com o índice
  // `(resolvedAt, lastSeenAt)` já existente, então não exige migration.
  const removedByAge = await prisma.errorLog.deleteMany({
    where: { resolvedAt: { not: null }, lastSeenAt: { lt: cutoff } },
  });

  const total = await prisma.errorLog.count();
  const overflow = Math.max(0, total - maxRows);
  const removedByCap = overflow > 0 ? await deleteOverflow(overflow) : 0;
  const remaining = total - removedByCap;

  if (removedByAge.count > 0 || removedByCap > 0) {
    log.info("logs de erro podados", {
      porIdade: removedByAge.count,
      porTeto: removedByCap,
      restantes: remaining,
    });
  }

  return { removedByAge: removedByAge.count, removedByCap, remaining };
}

/**
 * Apaga as linhas mais antigas até restar `amount`.
 *
 * Não usa `skip` com `take`: `skip` faz o banco materializar tudo que pula, que
 * é justamente o caso ruim quando há 30 mil linhas. Traz só a chave, na ordem, e
 * apaga pelo identificador.
 */
async function deleteOverflow(amount: number): Promise<number> {
  const oldest = await prisma.errorLog.findMany({
    orderBy: { lastSeenAt: "asc" },
    take: amount,
    select: { id: true },
  });

  if (oldest.length === 0) return 0;

  const deleted = await prisma.errorLog.deleteMany({
    where: { id: { in: oldest.map((row) => row.id) } },
  });

  return deleted.count;
}
