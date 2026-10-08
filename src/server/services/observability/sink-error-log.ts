import { recordServerError } from "@/server/services/error-log";
import { reportNewError } from "@/server/services/error-log-alert";
import { sendAlert, shortSummary } from "@/server/services/observability/alert";
import { pruneErrorLogsIfDue } from "@/server/services/observability/retention";
import type { IncidentSink, ScrubbedIncident } from "@/server/services/observability";

/**
 * Destino 1 — o banco local (`ErrorLog`).
 *
 * Este é o destino que **nunca** pode faltar. Ele não depende de terceiros, não
 * tem cota e não sai da VPS — é o que garante que um erro não se perca quando a
 * cota do fornecedor acabar ou a rede cair.
 *
 * Também é quem carrega o contexto que o fornecedor não tem: qual usuário e qual
 * unidade estavam no meio da operação.
 *
 * ## Por que o aviso sai daqui
 *
 * "Erro novo" só existe depois do agrupamento por fingerprint, que é o que o
 * `ErrorLog` faz. Logo, quem decide que um erro é novo é este destino — e é
 * dele que saem o sino do app e o Telegram. A instrumentação só entrega o
 * incidente; ela não conhece política de alerta.
 *
 * Isso também significa que a tela, o sino e o Telegram contam a mesma coisa:
 * os três partem do mesmo `outcome`.
 */
export const errorLogSink: IncidentSink = {
  name: "error-log",

  // O banco está sempre lá; não há configuração a desligar.
  enabled: true,

  async capture(incident: ScrubbedIncident): Promise<void> {
    // A poda roda junto com a gravação, no máximo uma vez por hora. Ver
    // `retention.ts` para por que não há cron.
    void pruneErrorLogsIfDue();

    const result = await recordServerError({
      message: incident.message,
      digest: incident.digest ?? null,
      stack: incident.stack,
      routePath: incident.routePath,
      // `kind` do incidente é o `routeType` do Next; o gravador usa esse campo.
      routeType: incident.kind,
      method: incident.method ?? null,
      actorId: incident.actorId ?? null,
      branchId: incident.branchId ?? null,
    });

    // Só a primeira ocorrência é novel. Notificar a cada repetição transformaria
    // o sino em ruído e esconderia justamente o problema mais grave.
    if (result.outcome !== "created") return;

    await Promise.allSettled([
      reportNewError(result.id),
      sendAlert({
        summary: shortSummary(incident.message),
        routePath: incident.routePath,
        digest: incident.digest,
        count: result.count,
      }),
    ]);
  },
};
