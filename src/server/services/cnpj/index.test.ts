import { afterEach, describe, expect, it, vi } from "vitest";

import { lookupCnpj } from "@/server/services/cnpj";

/** Trecho real da BrasilAPI, reduzido ao que usamos. */
const PAYLOAD = {
  cnpj: "19131243000197",
  razao_social: "OPEN KNOWLEDGE BRASIL",
  nome_fantasia: "REDE PELO CONHECIMENTO LIVRE",
  cnae_fiscal: 6201501,
  cep: "01310200",
  logradouro: "AVENIDA PAULISTA",
  numero: "37",
  complemento: "ANDAR 4 CONJ 41",
  bairro: "BELA VISTA",
  municipio: "SAO PAULO",
  uf: "SP",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("lookupCnpj", () => {
  it("consulta a API e devolve os dados traduzidos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(PAYLOAD));
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupCnpj("19131243000197");

    expect(result).toMatchObject({
      cnpj: "19131243000197",
      legalName: "OPEN KNOWLEDGE BRASIL",
      cnae: "6201501",
      city: "SAO PAULO",
      state: "SP",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("19131243000197");

    // O WAF da BrasilAPI responde 403 ao User-Agent padrão do `fetch`: sem um
    // UA próprio, a consulta funciona em teste mockado e quebra em produção.
    const init = fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined;
    expect(init?.headers?.["user-agent"]).toContain("almo-erp/");
  });

  it("lança NOT_FOUND quando o CNPJ não existe (404)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));

    await expect(lookupCnpj("00000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lança BUSINESS_RULE quando a API falha (5xx)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));

    await expect(lookupCnpj("19131243000197")).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("lança BUSINESS_RULE quando a rede falha", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(lookupCnpj("19131243000197")).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });

  it("lança BUSINESS_RULE quando o payload não tem o mínimo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ foo: 1 })));

    await expect(lookupCnpj("19131243000197")).rejects.toMatchObject({ code: "BUSINESS_RULE" });
  });
});
