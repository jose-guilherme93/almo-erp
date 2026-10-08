import { logger } from "@/lib/logger";
import { isIgnorableError } from "@/server/services/observability/ignorable";

const log = logger.with({ service: "instrumentation" });

/**
 * Relata um erro de requisição ao funil de incidentes.
 *
 * Vive em módulo separado, e não em `instrumentation.ts`, por um motivo concreto:
 * `instrumentation.ts` também é compilado para a **edge**, onde não existe
 * Prisma nem `node:crypto`. Se o relato morasse ali, o bundle da edge carregaria
 * o cliente de banco — e o aviso apareceria na hora de subir, não no relatório
 * de erro.
 *
 * Só este módulo sabe falar com o funil; a instrumentação limita-se a perguntar
 * "isto é erro?" e repassar.
 */
export async function reportRequestError(payload: {
  kind: string;
  routePath: string;
  method?: string | null;
  message: string;
  stack: string | null;
  digest: string | null;
  headers?: Record<string, string | string[] | undefined>;
}): Promise<void> {
  if (isIgnorableError(payload.message)) {
    log.debug("erro ignorado (navegação abortada)", {
      routePath: payload.routePath,
      kind: payload.kind,
    });

    return;
  }

  const { dispatchIncident } = await import("@/server/services/observability");

  await dispatchIncident({
    kind: payload.kind,
    routePath: payload.routePath,
    method: payload.method,
    message: payload.message,
    stack: payload.stack,
    digest: payload.digest,
    context: { source: "instrumentation" },
    headers: payload.headers,
  });
}
