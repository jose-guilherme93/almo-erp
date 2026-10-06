import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";

import { resetEnvCache } from "@/lib/env";
import {
  formatMessage,
  isThrottled,
  resetAlertThrottle,
  sendAlert,
  shortSummary,
  type AlertPayload,
} from "@/server/services/observability/alert";

/**
 * Alerta de Telegram.
 *
 * É o único aviso que chega sem ninguém abrir a aplicação, então o que se
 * prova aqui é o contrário do óbvio: que o canal **falha em silêncio** e que
 * **não vaza**. Um alerta que derruba a requisição, ou que enche o chat, troca
 * um erro visível por ruído.
 */

let server: ReturnType<typeof createServer>;
let port = 0;
let received: Array<{ body: unknown }> = [];
let nextStatus = 200;

/** O Telegram real fica bloqueado: o teste só fala com o servidor local. */
const originalFetch = globalThis.fetch;

function payload(overrides: Partial<AlertPayload> = {}): AlertPayload {
  return {
    summary: "Falha ao carregar o painel de estoque",
    routePath: "/estoque",
    digest: "abc123",
    count: 1,
    ...overrides,
  };
}

beforeEach(async () => {
  received = [];
  nextStatus = 200;
  resetAlertThrottle();

  server = createServer((req, res) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");

      received.push({ body: raw ? JSON.parse(raw) : null });
      res.writeHead(nextStatus);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;

  process.env["TELEGRAM_BOT_TOKEN"] = "token-de-teste";
  process.env["TELEGRAM_CHAT_ID"] = "123456";
  resetEnvCache();

  // Redireciona apenas o host do Telegram para o servidor local.
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);

    if (url.startsWith("https://api.telegram.org/")) {
      return originalFetch(`http://127.0.0.1:${port}/sendMessage`, init);
    }

    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;

  delete process.env["TELEGRAM_BOT_TOKEN"];
  delete process.env["TELEGRAM_CHAT_ID"];
  resetEnvCache();

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("shortSummary", () => {
  it("fica só com a primeira linha, que é a que tem a informação", () => {
    const message = "Erro: saldo insuficiente\n  at postDocument\n  at runAction";

    expect(shortSummary(message)).toBe("Erro: saldo insuficiente");
  });

  it("corta o que passa do limite, para não empurrar o resto para baixo", () => {
    expect(shortSummary("x".repeat(400)).length).toBeLessThanOrEqual(161);
  });

  it("não quebra com mensagem vazia", () => {
    expect(shortSummary("")).toBe("");
  });
});

describe("formatMessage", () => {
  it("leva resumo, rota e digest — o que serve para diagnosticar", () => {
    const text = formatMessage(payload());

    expect(text).toContain("Falha ao carregar o painel de estoque");
    expect(text).toContain("Rota: /estoque");
    expect(text).toContain("Digest: abc123");
  });

  it("não mostra ocorrência quando é a primeira", () => {
    expect(formatMessage(payload({ count: 1 }))).not.toContain("Ocorrências");
  });

  it("mostra o acumulado quando o erro se repete", () => {
    expect(formatMessage(payload({ count: 37 }))).toContain("Ocorrências: 37");
  });

  it("omite o que não existe, sem deixar linha vazia", () => {
    const text = formatMessage({ summary: "Falha", routePath: null, digest: null, count: null });

    expect(text).not.toContain("Rota:");
    expect(text).not.toContain("null");
    expect(text).not.toContain("undefined");
  });
});

describe("sendAlert", () => {
  it("não faz nada sem token, e isso não é erro", async () => {
    delete process.env["TELEGRAM_BOT_TOKEN"];
    resetEnvCache();

    await expect(sendAlert(payload())).resolves.toBeUndefined();
    expect(received).toHaveLength(0);
  });

  it("entrega o alerta no chat configurado", async () => {
    await sendAlert(payload());

    expect(received).toHaveLength(1);
    expect(received[0]?.body).toMatchObject({ chat_id: "123456" });
  });

  // O requisito que dá nome ao módulo.
  it("não enche o chat quando o mesmo erro se repete", async () => {
    await sendAlert(payload());
    await sendAlert(payload());
    await sendAlert(payload());

    expect(received).toHaveLength(1);
  });

  it("alerta de novo quando o erro é outro", async () => {
    await sendAlert(payload());
    await sendAlert(payload({ summary: "Falha ao aprovar solicitação" }));

    expect(received).toHaveLength(2);
  });

  it("alerta de novo quando a rota é outra", async () => {
    await sendAlert(payload());
    await sendAlert(payload({ routePath: "/solicitacoes" }));

    expect(received).toHaveLength(2);
  });

  it("libera o freio depois da janela", async () => {
    // Sem controlar o relógio, o teste só provaria que o freio existe — não que
    // ele expira, que é a parte que importa para o canal não ficar mudo para
    // sempre depois do primeiro aviso.
    vi.useFakeTimers();

    try {
      await sendAlert(payload());

      expect(isThrottled(payload())).toBe(true);

      vi.setSystemTime(new Date(Date.now() + 16 * 60_000));

      expect(isThrottled(payload())).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("não lança quando o Telegram recusa", async () => {
    nextStatus = 401;

    await expect(sendAlert(payload())).resolves.toBeUndefined();
  });

  it("não lança quando a rede não responde", async () => {
    const savedFetch = globalThis.fetch;

    globalThis.fetch = (() => Promise.reject(new Error("ECONNREFUSED"))) as typeof fetch;

    try {
      await expect(sendAlert(payload())).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("nao marca como enviado quando o envio falha, para o proximo erro alertar", async () => {
    nextStatus = 500;

    await sendAlert(payload());

    // Falhou: o freio não pode engolir o próximo incidente do mesmo erro.
    expect(isThrottled(payload())).toBe(false);
  });
});
