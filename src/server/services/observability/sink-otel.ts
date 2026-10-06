import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { IncidentSink, ScrubbedIncident } from "@/server/services/observability";

const log = logger.with({ service: "observability.otel" });

/**
 * Destino 3 — OpenTelemetry (OTLP/HTTP), **já escrito e desligado**.
 *
 * Este destino existe para o dia em que os dados forem para a sua própria VPS:
 * Grafana + Loki + Tempo (ou o OTel Collector) no Dokploy. O formato é o padrão
 * OTLP, então qualquer backends speak — trocar de Loki para Tempo, ou para o
 * Collector, é configuração, não código.
 *
 * Por que já está aqui, desligado:
 *
 * - Não custa nada ligado: sem endpoint configurado, `enabled` é `false` e nada
 *   acontece.
 * - Testar o caminho OTLP **depois** seria tarde. Se a migração só descobrir
 *   problema de firewall ou de formato no dia em que a plataforma já está no
 *   ar, o troubleshooting acontece com pressão.
 * - O teste de integração que exercita o transporte está em `sink-otel.test.ts`:
 *   ele sobe um servidor HTTP local e prova que o evento chega no formato certo.
 *
 * Ativar: definir `OTEL_EXPORTER_OTLP_ENDPOINT` (e, se o collector exigir,
 * `OTEL_EXPORTER_OTLP_HEADERS`) no Dokploy. Nada no código muda.
 */
export const otelSink: IncidentSink = {
  name: "otel",

  get enabled(): boolean {
    return Boolean(getEnv().OTEL_EXPORTER_OTLP_ENDPOINT);
  },

  async capture(incident: ScrubbedIncident): Promise<void> {
    const endpoint = getEnv().OTEL_EXPORTER_OTLP_ENDPOINT;

    if (!endpoint) return;

    const body = buildOtlpLogRecord(incident);
    const url = `${endpoint.replace(/\/$/, "")}/v1/logs`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...parseOtlpHeaders(getEnv().OTEL_EXPORTER_OTLP_HEADERS),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        log.warn("otel recusou o evento", { status: response.status, url });
      }
    } catch (error) {
      // Nunca propaga: o incidente já foi gravado no banco e no fornecedor.
      log.warn("falha ao enviar para otel", { url, error });
    }
  },
};

/**
 * Monta um `ExportLogsServiceRequest` no formato OTLP/JSON.
 *
 * O evento vira um log de nível `ERROR` com atributos derivados do incidente. É
 * o formato que o Collector e o Tempo engolem sem configuração extra.
 */
export function buildOtlpLogRecord(incident: ScrubbedIncident): Record<string, unknown> {
  const now = incident.occurredAt ?? new Date();
  const nanoseconds = String(now.getTime()) + "000000";

  const attributes: Record<string, { stringValue: string }> = {};

  for (const [key, value] of Object.entries({
    "almo.kind": incident.kind,
    "almo.route": incident.routePath,
    "almo.method": incident.method ?? "",
    "almo.digest": incident.digest ?? "",
    "almo.actor_id": incident.actorId ?? "",
    "almo.branch_id": incident.branchId ?? "",
    "almo.release": incident.release ?? "",
    "almo.message": incident.message,
  })) {
    attributes[key] = { stringValue: value };
  }

  return {
    resourceLogs: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: "almo-erp" } }],
        },
        scopeLogs: [
          {
            logRecords: [
              {
                timeUnixNano: nanoseconds,
                severityNumber: 17, // ERROR na semântica OTLP
                severityText: "ERROR",
                body: { stringValue: incident.stack ?? incident.message },
                attributes,
              },
            ],
          },
        ],
      },
    ],
  };
}

/** `key1=value1,key2=value2` → objeto de cabeçalho. */
export function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};

  const result: Record<string, string> = {};

  for (const pair of raw.split(",")) {
    const [key, ...rest] = pair.split("=");
    const value = rest.join("=").trim();

    if (key?.trim() && value) result[key.trim()] = value;
  }

  return result;
}
