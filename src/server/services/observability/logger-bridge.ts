import { setErrorReporter, type LogContext } from "@/lib/logger";
import {
  dispatchIncident,
  isDispatchingIncident,
  type Incident,
} from "@/server/services/observability";

/**
 * Ponte entre o logger estruturado e o funil de incidentes.
 *
 * O `logger.error` escrevia só no stdout. O `ErrorLog` — e portanto a tela
 * `/admin/erros` e o alerta — só recebia o que passava por `onRequestError`,
 * `runAction`, guards de processo ou o cliente. Toda falha que um serviço captura
 * e **logava** (auditoria, notificação, retenção) vivia e morria no container:
 * existia no log e não existia para o super admin. Esta ponte fecha a lacuna
 * que a AGENTS.md §9.5 descreve — *tudo que quebra sai pelo funil*.
 *
 * O caminho inverso não pode existir: os sinks **usam** `logger.error` para
 * relatar falha. Se todo `log.error` voltasse ao funil, uma falha de destino
 * geraria outra falha, sem fim. A guarda é `isDispatchingIncident()`: dentro de
 * um dispatch, o logger é só stdout.
 *
 * Registrada no boot pelo servidor (`instrumentation.ts`); na edge, no cliente e
 * no build não há registro — e é correto que não haja: não há Prisma ali.
 */
export function installLoggerBridge(): void {
  setErrorReporter((message, context) => {
    if (isDispatchingIncident()) return;

    void dispatchIncident(incidentFromLog(message, context));
  });
}

/** Rota de um erro sem rota conhecida. Não é uma tela — é o logger. */
const LOG_ONLY_ROUTE = "(log)";

/**
 * Traduz uma chamada de `logger.error` em incidente.
 *
 * Função pura e exportada para ser testável sem banco. O `context` inteiro vai
 * como contexto do incidente: o `scrub` de cada destino decide o que sai (o sink
 * do Sentry passa por `scrubObject`; o do banco ignora o contexto).
 */
export function incidentFromLog(message: string, context: LogContext): Incident {
  const error = context["error"];
  const detail = error instanceof Error ? error.message : null;

  return {
    kind: "log",
    routePath: routeFromContext(context),
    message: detail ? `${message} — ${detail}` : message,
    stack: error instanceof Error ? (error.stack ?? null) : null,
    context: { source: "logger", ...context },
  };
}

function routeFromContext(context: LogContext): string {
  const routePath = context["routePath"];

  return typeof routePath === "string" && routePath.length > 0 ? routePath : LOG_ONLY_ROUTE;
}
