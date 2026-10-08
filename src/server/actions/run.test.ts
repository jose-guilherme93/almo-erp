import { beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "@/lib/errors";
import { runAction } from "@/server/actions/run";

/**
 * `runAction` — a fronteira entre erro previsto e defeito.
 *
 * A action engole a exceção e devolve `{ ok: false }` ao componente. É o
 * comportamento certo para a tela e o errado para quem opera: sem esta distinção,
 * um usuário que esqueceu de escrever a justificativa aparece como incidente, o
 * `ErrorLog` enche de erro de digitação, e o defeito de verdade se esconde no
 * meio. Isso não apareceu em teste unitário — apareceu olhando o banco depois de
 * rodar a interface.
 *
 * Por isso o módulo é mockado no limite: o que se prova é **quem é relatado**, e
 * não o que acontece lá dentro.
 */

// O parâmetro é tipado para que `.mock.calls` guarde a assinatura — sem ele, o
// array fica `[]` e o acesso ao incidente não compila. O corpo não usa o valor.
const dispatchIncident = vi.hoisted(() =>
  vi.fn(async (incident: { kind: string; routePath: string; message: string }) => {
    void incident;
  }),
);

vi.mock("@/server/services/observability", () => ({
  dispatchIncident,
}));

/** Cabeçalhos que o teste finge ter; controlado por caso. */
let fakeHeaders: Record<string, string> = {};

// `next/headers` só funciona dentro de requisição, e o que existe aqui é um
// cabeçalho controlado — é assim que se prova de onde a rota sai.
vi.mock("next/headers", () => ({
  headers: async () => new Headers(fakeHeaders),
}));

/** Dispara uma falha inesperada e devolve a rota que o funil recebeu. */
async function reportedRoute(message = "falha inesperada"): Promise<string> {
  await runAction(async () => {
    throw new Error(message);
  });

  const incidente = dispatchIncident.mock.calls.at(-1)?.[0];

  if (!incidente) throw new Error("o incidente não foi relatado");

  return incidente.routePath;
}

beforeEach(() => {
  dispatchIncident.mockClear();
  fakeHeaders = {};
});

describe("runAction", () => {
  it("devolve a mensagem de erro de domínio ao usuário", async () => {
    const result = await runAction(async () => {
      throw new ValidationError("A justificativa é obrigatória.");
    });

    expect(result.ok).toBe(false);
  });

  // A regra central: falha prevista não é incidente.
  it("não relata erro de domínio — o produto recusou, não quebrou", async () => {
    await runAction(async () => {
      throw new ValidationError("A justificativa é obrigatória.");
    });

    expect(dispatchIncident).not.toHaveBeenCalled();
  });

  it("relata erro inesperado, que é o que ninguém esperava", async () => {
    await runAction(async () => {
      throw new Error("connection pool exhausted");
    });

    expect(dispatchIncident).toHaveBeenCalledTimes(1);

    const incidente = dispatchIncident.mock.calls[0]?.[0];

    expect(incidente?.kind).toBe("action");
    expect(incidente?.message).toBe("connection pool exhausted");
  });

  // Recurso não implementado é o produto incompleto: quem clica precisa saber.
  it("relata recurso não implementado, apesar de ser AppError", async () => {
    await runAction(async () => {
      throw new (await import("@/lib/errors")).NotImplementedError("transferência em lote");
    });

    expect(dispatchIncident).toHaveBeenCalledTimes(1);
  });

  it("não relata quando a action dá certo", async () => {
    await runAction(async () => ({ ok: true, data: undefined }));

    expect(dispatchIncident).not.toHaveBeenCalled();
  });

  // `redirect()` depende do throw para funcionar; converter quebraria a navegação.
  it("deixa o redirect escapar em vez de converter em falha", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/solicitacoes",
    });

    await expect(
      runAction(async () => {
        throw redirect;
      }),
    ).rejects.toBe(redirect);

    expect(dispatchIncident).not.toHaveBeenCalled();
  });

  it("não relata notFound, que é o Next describing uma rota que não existe", async () => {
    const notFound = Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });

    await expect(
      runAction(async () => {
        throw notFound;
      }),
    ).rejects.toBe(notFound);

    expect(dispatchIncident).not.toHaveBeenCalled();
  });

  it("não espera o relato para responder: quem está no balcão não espera a rede", async () => {
    // O relato sai sem `await`: um destino lento não pode virar lentidão na tela.
    await runAction(async () => {
      throw new Error("defeito");
    });

    expect(dispatchIncident).toHaveBeenCalled();
  });
});

describe("rota da action", () => {
  it("acha a tela pela navegação RSC", async () => {
    fakeHeaders = { "next-url": "/estoque/entradas/nova?x=1" };

    expect(await reportedRoute()).toBe("/estoque/entradas/nova");
  });

  // A maioria das actions chega por POST de formulário, e aí não vem `next-url`.
  // Sem esta parte, todo incidente de action nascia como `(server action)`.
  it("acha a tela pelo referer quando o formulário é submetido", async () => {
    fakeHeaders = { referer: "http://localhost:3001/estoque/ajustes/novo" };

    expect(await reportedRoute()).toBe("/estoque/ajustes/novo");
  });

  it("prefere o next-url quando os dois existem", async () => {
    fakeHeaders = {
      "next-url": "/catalogo/itens",
      referer: "http://localhost:3001/outra",
    };

    expect(await reportedRoute()).toBe("/catalogo/itens");
  });

  it("descarta a query string, que em tela com filtro carrega dado de pessoa", async () => {
    fakeHeaders = { referer: "http://localhost:3001/relatorios?nome=Joao&cpf=123" };

    const rota = await reportedRoute();

    expect(rota).toBe("/relatorios");
    expect(rota).not.toContain("Joao");
    expect(rota).not.toContain("cpf");
  });

  it("não inventa rota quando não há cabeçalho nenhum", async () => {
    // Job, script, CLI: melhor sem rota do que com rota inventada.
    expect(await reportedRoute()).toBe("(server action)");
  });

  it("ignora cabeçalho que não é caminho", async () => {
    fakeHeaders = { referer: "sobre:blank", "next-url": "" };

    expect(await reportedRoute()).toBe("(server action)");
  });
});
