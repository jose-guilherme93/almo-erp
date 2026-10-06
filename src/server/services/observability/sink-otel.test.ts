import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetEnvCache } from "@/lib/env";
import {
  buildOtlpLogRecord,
  otelSink,
  parseOtlpHeaders,
} from "@/server/services/observability/sink-otel";
import type { ScrubbedIncident } from "@/server/services/observability";

/**
 * Destino OTLP — o caminho que serve à migração para Grafana na VPS.
 *
 * Testar isso depois da migração seria tarde: o dia de trocar o backend é o pior
 * dia para descobrir que o formato ou a porta do Collector estão errados. Aqui
 * o transporte é exercitado de verdade, contra um servidor HTTP local.
 */

type Received = { url: string; headers: Record<string, unknown>; body: unknown };

let server: ReturnType<typeof createServer>;
let port = 0;
let received: Received[] = [];
let nextStatus = 202;

function incident(overrides: Partial<ScrubbedIncident> = {}): ScrubbedIncident {
  return {
    kind: "render",
    routePath: "/catalogo/itens",
    method: "GET",
    message: "Falha ao carregar o painel",
    stack: "Error: Falha ao carregar o painel\n  at page",
    digest: "digest-abc",
    actorId: null,
    branchId: null,
    release: "1.2.0",
    occurredAt: new Date("2026-10-06T12:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(async () => {
  received = [];
  nextStatus = 202;

  server = createServer((req, res) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");

      received.push({
        url: req.url ?? "",
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      });

      res.writeHead(nextStatus);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;

  process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = `http://127.0.0.1:${port}`;
  process.env["OTEL_EXPORTER_OTLP_HEADERS"] = "x-api-key=segredo-de-teste";
  resetEnvCache();
});

afterEach(async () => {
  delete process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  delete process.env["OTEL_EXPORTER_OTLP_HEADERS"];
  resetEnvCache();

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("parseOtlpHeaders", () => {
  it("lê pares separados por vírgula", () => {
    expect(parseOtlpHeaders("a=1, b=2")).toEqual({ a: "1", b: "2" });
  });

  it("preserva valor com sinal de igual", () => {
    expect(parseOtlpHeaders("authorization=Bearer a=b")).toEqual({
      authorization: "Bearer a=b",
    });
  });

  it("devolve vazio quando não há nada", () => {
    expect(parseOtlpHeaders(undefined)).toEqual({});
    expect(parseOtlpHeaders("")).toEqual({});
  });
});

describe("buildOtlpLogRecord", () => {
  it("monta um ExportLogsServiceRequest válido", () => {
    const resourceLogs = buildOtlpLogRecord(incident())["resourceLogs"] as Array<
      Record<string, unknown>
    >;
    expect(resourceLogs).toHaveLength(1);

    const scopeLogs = resourceLogs[0]?.["scopeLogs"] as Array<Record<string, unknown>>;
    const logRecords = scopeLogs[0]?.["logRecords"] as Array<Record<string, unknown>>;
    const record = logRecords[0];

    expect(record?.["severityText"]).toBe("ERROR");
    expect(record?.["severityNumber"]).toBe(17);
    // 13 dígitos de milissegundo + 6 de nanossegundo.
    expect(record?.["timeUnixNano"]).toBe("1791288000000000000");
  });

  it("carrega rota e digest como atributo, que é o que se busca depois", () => {
    const resourceLogs = buildOtlpLogRecord(incident())["resourceLogs"] as Array<
      Record<string, unknown>
    >;
    const scopeLogs = resourceLogs[0]?.["scopeLogs"] as Array<Record<string, unknown>>;
    const logRecords = scopeLogs[0]?.["logRecords"] as Array<Record<string, unknown>>;
    const attributes = logRecords[0]?.["attributes"] as Record<string, { stringValue: string }>;

    expect(attributes["almo.route"]?.stringValue).toBe("/catalogo/itens");
    expect(attributes["almo.digest"]?.stringValue).toBe("digest-abc");
    expect(attributes["almo.kind"]?.stringValue).toBe("render");
    expect(attributes["almo.release"]?.stringValue).toBe("1.2.0");
  });
});

describe("otelSink", () => {
  it("fica desligado sem endpoint configurado", () => {
    delete process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
    resetEnvCache();

    expect(otelSink.enabled).toBe(false);
  });

  it("liga com endpoint configurado", () => {
    expect(otelSink.enabled).toBe(true);
  });

  it("entrega o evento no endpoint de logs", async () => {
    await otelSink.capture(incident());

    expect(received).toHaveLength(1);
    expect(received[0]?.url).toBe("/v1/logs");
    expect(received[0]?.headers["content-type"]).toBe("application/json");
    expect(received[0]?.headers["x-api-key"]).toBe("segredo-de-teste");
  });

  it("tolera barra no fim do endpoint", async () => {
    process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = `http://127.0.0.1:${port}/`;
    resetEnvCache();

    await otelSink.capture(incident());

    expect(received[0]?.url).toBe("/v1/logs");
  });

  // Uma indisponibilidade do backend não pode virar erro novo no sistema.
  it("não propaga erro quando o backend recusa", async () => {
    nextStatus = 500;

    await expect(otelSink.capture(incident())).resolves.toBeUndefined();
  });

  it("não propaga erro quando o backend não responde", async () => {
    process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://127.0.0.1:1";
    resetEnvCache();

    await expect(otelSink.capture(incident())).resolves.toBeUndefined();
  });
});
