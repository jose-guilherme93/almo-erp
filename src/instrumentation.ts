import type { Instrumentation } from "next";

import { logger } from "@/lib/logger";
import { isIgnorableError } from "@/server/services/observability/ignorable";

const log = logger.with({ service: "instrumentation" });

/**
 * Ponto único de captura de erro de servidor.
 *
 * Tudo que quebra no servidor passa por aqui e sai para o funil, que distribui
 * para os destinos configurados: o banco local (sempre), o fornecedor externo
 * (Better Stack hoje) e o OTLP (Grafana na VPS, quando ligado). Como a captação
 * não conhece os destinos, migrar de fornecedor é mudar variável de ambiente.
 *
 * ## Por que quase nada é importado aqui
 *
 * Este arquivo roda em **dois runtimes**: o Node (servidor de página) e a edge
 * (`proxy.ts`). A edge não tem Prisma nem `node:crypto`, então qualquer coisa
 * que dependa disso precisa entrar por `import()` dinâmico **guardado por
 * `NEXT_RUNTIME`**. O guard não é preciosismo: é ele que permite ao compilador
 * eliminar o código na build da edge. Sem o guard, o bundle da edge carregaria o
 * cliente de banco e a aplicação quebraria ao subir — não no relatório de erro.
 *
 * Por isso este arquivo só importa o que é puro.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // Nunca lançar: se esta função falhar, o Next registra
  // "Error in instrumentation.onRequestError" e o erro original se perde.
  try {
    const message = error instanceof Error ? error.message : String(error);

    // Cancelamento de navegação não é defeito: o usuário saiu da página antes
    // do stream terminar. Sem este filtro a tela viria parede de ruído.
    if (isIgnorableError(message)) {
      log.debug("erro ignorado (navegação abortada)", {
        routePath: request.path,
        kind: context.routeType,
      });

      return;
    }

    const digest = digestOf(error);

    // A edge não tem onde gravar: o `ErrorLog` é Postgres. O SDK da edge, que
    // já foi inicializado no `register()`, é quem recebe o evento lá.
    if (context.routeType === "proxy" || process.env.NEXT_RUNTIME !== "nodejs") {
      log.error("erro na edge", { routePath: request.path, digest, message });

      return;
    }

    const { reportRequestError } = await import("@/server/services/observability/report");

    await reportRequestError({
      kind: context.routeType,
      routePath: request.path,
      method: request.method,
      message,
      stack: error instanceof Error ? (error.stack ?? null) : null,
      digest,
      headers: request.headers,
    });
  } catch {
    // Última linha: se nem o log funcionou, não há mais para onde olhar.
  }
};

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/sentry.server.config");

    const { installProcessGuards } = await import("@/server/services/observability/process-guards");

    installProcessGuards();

    // Liga `logger.error` ao funil: sem isto, uma falha que um serviço captura e
    // loga (auditoria, notificação) nunca chega a `/admin/erros`.
    const { installLoggerBridge } = await import("@/server/services/observability/logger-bridge");

    installLoggerBridge();

    return;
  }

  await import("@/sentry.edge.config");
}

/** O Next pode reusar o mesmo digest; ainda é a melhor chave de correlação. */
function digestOf(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "digest" in error) {
    const digest = (error as { digest?: unknown }).digest;

    if (typeof digest === "string") return digest;
  }

  return null;
}
