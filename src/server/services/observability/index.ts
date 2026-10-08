import { logger } from "@/lib/logger";
import { scrubHeaders, scrubMessage, scrubPath } from "@/server/services/observability/scrub";
import { errorLogSink } from "@/server/services/observability/sink-error-log";
import { otelSink } from "@/server/services/observability/sink-otel";
import { sentrySink } from "@/server/services/observability/sink-sentry";

const log = logger.with({ service: "observability" });

/**
 * Um incidente: algo quebrou, com o contexto mínimo para investigá-lo.
 *
 * É o formato único que circula dentro do sistema. O `ErrorLog` no Postgres e o
 * fornecedor externo (Better Stack hoje) são **consumidores** deste formato, não
 * o contrário — por isso trocar de fornecedor não toca na captação.
 */
export type Incident = {
  /** `render` | `route` | `action` | `client` | `process` | `proxy`. */
  kind: string;
  /** Caminho da rota, já sem query string. */
  routePath: string;
  method?: string | null;
  message: string;
  stack?: string | null;
  /** O código que o usuário viu na tela. */
  digest?: string | null;
  actorId?: string | null;
  branchId?: string | null;
  release?: string | null;
  context?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
  occurredAt?: Date;
};

/** Erro já preparado para sair: com o scrubbing aplicado. */
export type ScrubbedIncident = Omit<Incident, "message" | "stack" | "routePath" | "headers"> & {
  message: string;
  stack: string | null;
  routePath: string;
  headers?: Record<string, string | string[] | undefined>;
};

/**
 * Remove dado pessoal antes de qualquer saída.
 *
 * Este é o **único** ponto por onde um incidente pode sair do processo, então é
 * aqui que a barreira LGPD precisa ficar: um sink novo que esqueça de chamar
 * isto vaza dado, e a falha apareceria só em produção.
 */
export function scrubIncident(incident: Incident): ScrubbedIncident {
  const scrubbed: ScrubbedIncident = {
    ...incident,
    routePath: scrubPath(incident.routePath),
    message: scrubMessage(incident.message),
    stack: incident.stack ? scrubMessage(incident.stack, 8_000) : null,
  };

  if (incident.headers) scrubbed.headers = scrubHeaders(incident.headers);

  return scrubbed;
}

/**
 * Destino de incidente.
 *
 * O contrato é mínimo de propósito: nome, se está ativo, e capturar. É o que
 * permite rodar dois ao mesmo tempo (o banco **e** um fornecedor) e trocar o
 * fornecedor sem tocar em quem emite.
 */
export type IncidentSink = {
  readonly name: string;
  /** `false` quando falta configuração. Nunca lança: o alerta é best-effort. */
  readonly enabled: boolean;
  capture(incident: ScrubbedIncident): Promise<void>;
};

let registry: IncidentSink[] | undefined;

/**
 * Os destinos configurados.
 *
 * A ordem importa: o banco primeiro (é a rede de segurança, não depende de
 * terceiro), o fornecedor depois.
 */
export function sinks(): IncidentSink[] {
  registry ??= buildSinks();
  return registry;
}

/** Só para teste: força a releitura do registry. */
export function resetSinks(): void {
  registry = undefined;
}

function buildSinks(): IncidentSink[] {
  // Ordem importa: o banco primeiro (é a rede de segurança e não depende de
  // terceiro), o fornecedor depois.
  return [errorLogSink, sentrySink, otelSink];
}

/**
 * Entrega o incidente a todos os destinos ativos.
 *
 * **Nunca lança.** Um destino que falha (rede, cota, credencial) não pode
 * derrubar a requisição que já estava falhando — e muito menos o trabalho de
 * quem está sendo atendido.
 */
export async function dispatchIncident(incident: Incident): Promise<void> {
  const scrubbed = scrubIncident(incident);

  await Promise.allSettled(
    sinks()
      .filter((sink) => sink.enabled)
      .map(async (sink) => {
        try {
          await sink.capture(scrubbed);
        } catch (error) {
          log.error("falha no destino de incidente", { sink: sink.name, error });
        }
      }),
  );
}

/** Nomes dos destinos ativos — para a tela de observabilidade. */
export function activeSinkNames(): string[] {
  return sinks()
    .filter((sink) => sink.enabled)
    .map((sink) => sink.name);
}
