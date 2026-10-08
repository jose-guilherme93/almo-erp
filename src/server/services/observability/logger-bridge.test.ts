import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A ponte `logger.error` → funil.
 *
 * O que se prova aqui é a **ligação** e as duas guardas que a impedem de virar
 * laço: dentro de um dispatch não há novo relato, e `warn` não é incidente. O
 * contrato do funil (gravar, deduplicar, alertar) tem teste próprio.
 */

const dispatchIncident = vi.hoisted(() =>
  vi.fn(async (incident: { kind: string }) => {
    void incident;
  }),
);
const isDispatchingIncident = vi.hoisted(() => vi.fn(() => false));

vi.mock("@/server/services/observability", () => ({
  dispatchIncident,
  isDispatchingIncident,
}));

import { logger, setErrorReporter } from "@/lib/logger";
import {
  incidentFromLog,
  installLoggerBridge,
} from "@/server/services/observability/logger-bridge";

beforeEach(() => {
  installLoggerBridge();
  dispatchIncident.mockClear();
  isDispatchingIncident.mockReturnValue(false);
});

afterEach(() => {
  setErrorReporter(null);
});

describe("incidentFromLog", () => {
  it("usa o stack do Error cru, que a serialização do log esconderia", () => {
    const incident = incidentFromLog("falha ao gravar auditoria", {
      error: new Error("conexão recusada"),
    });

    expect(incident.kind).toBe("log");
    expect(incident.message).toContain("falha ao gravar auditoria");
    expect(incident.message).toContain("conexão recusada");
    expect(incident.stack).toContain("conexão recusada");
    expect(incident.routePath).toBe("(log)");
  });

  it("usa a rota do contexto quando existe", () => {
    expect(incidentFromLog("falha", { routePath: "/estoque/entradas" }).routePath).toBe(
      "/estoque/entradas",
    );
  });
});

describe("installLoggerBridge", () => {
  it("leva o logger.error ao funil", () => {
    logger.error("falha ao criar notificação", {
      type: "REQUEST_CREATED",
      error: new Error("deadlock"),
    });

    expect(dispatchIncident).toHaveBeenCalledTimes(1);
    expect(dispatchIncident.mock.calls[0]?.[0]).toMatchObject({ kind: "log" });
  });

  it("não relata de novo dentro de um dispatch — senão a falha vira laço", () => {
    isDispatchingIncident.mockReturnValue(true);

    logger.error("falha no destino de incidente", { error: new Error("rede") });

    expect(dispatchIncident).not.toHaveBeenCalled();
  });

  it("não relata warn: ruído não é incidente", () => {
    logger.warn("telegram recusou o alerta", { status: 429 });

    expect(dispatchIncident).not.toHaveBeenCalled();
  });
});
