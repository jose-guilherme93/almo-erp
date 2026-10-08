import * as Sentry from "@sentry/nextjs";

import { getEnv } from "@/lib/env";
import { scrubObject } from "@/server/services/observability/scrub";
import type { IncidentSink, ScrubbedIncident } from "@/server/services/observability";

/**
 * Destino 2 — fornecedor externo de erro.
 *
 * Hoje é o Better Stack, que aceita o payload do SDK do Sentry: **o DSN aponta
 * para lá e a instrumentação é a do Sentry**. É por isso que trocar de
 * fornecedor — inclusive para um Grafana na VPS — é mudar variável de ambiente,
 * não reescrever instrumentação.
 *
 * O destino é declarado **desligado** quando falta DSN, para que a aplicação
 * suba e funcione normalmente num ambiente sem ele (dev, CI, preview). Nada
 * aqui é obrigatório para o sistema rodar.
 */
export const sentrySink: IncidentSink = {
  name: "better-stack",

  get enabled(): boolean {
    return Boolean(getEnv().NEXT_PUBLIC_SENTRY_DSN);
  },

  async capture(incident: ScrubbedIncident): Promise<void> {
    const { release } = incident;

    Sentry.captureException(
      // Reconstrói um Error para o SDK extrair o stack como deve. A mensagem já
      // passou pelo scrubbing antes de chegar aqui.
      errorFromIncident(incident),
      {
        tags: {
          kind: incident.kind,
          route: incident.routePath,
          method: incident.method ?? "UNKNOWN",
          digest: incident.digest ?? "sem-digest",
          actorId: incident.actorId ?? "anonimo",
          branchId: incident.branchId ?? "sem-filial",
        },
        extra: scrubObject({
          context: incident.context ?? {},
          routePath: incident.routePath,
          method: incident.method,
          digest: incident.digest,
          actorId: incident.actorId,
          branchId: incident.branchId,
          occurredAt: incident.occurredAt?.toISOString(),
        }),
        level: "error",
        ...(release ? { release } : {}),
      },
    );
  },
};

function errorFromIncident(incident: ScrubbedIncident): Error {
  const error = new Error(incident.message);

  if (incident.stack) error.stack = incident.stack;

  return error;
}
