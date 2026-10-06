import { describe, expect, it } from "vitest";

import {
  REDACTED_LINE,
  REDACTED_PLACEHOLDER,
  scrubHeaders,
  scrubMessage,
  scrubObject,
  scrubPath,
  scrubText,
} from "@/server/services/observability/scrub";

/**
 * Remoção de dado pessoal.
 *
 * É a barreira LGPD deste projeto: o que sai da VPS precisa poder ser lido por
 * terceiro sem expor aluno, professor ou fornecedor. O teste de "somei o CPF"
 * vale mais que qualquer teste de quantidade.
 */

describe("scrubText", () => {
  it("remove bearer token", () => {
    expect(scrubText("Authorization: Bearer abcdef123456ghijkl")).not.toContain(
      "abcdef123456ghijkl",
    );
  });

  it("remove JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaa.bbbb";

    expect(scrubText(`token ${jwt}`)).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  });

  it("remove hex longo, que é token ou hash", () => {
    expect(scrubText("session a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6")).not.toContain("a1b2c3d4e5f6");
  });

  it("remove credencial embutida em URL", () => {
    const url = "postgresql://almo:supersenha@localhost:5432/almo";

    expect(scrubText(url)).not.toContain("supersenha");
  });

  it("mantém texto normal", () => {
    expect(scrubText("Conexão recusada pelo Postgres")).toBe("Conexão recusada pelo Postgres");
  });

  // Aqui não há campo: é o valor solto na mensagem. Um filtro que só olhasse o
  // nome do campo não veria nada, e num ERP escolar o valor solto é o CPF.
  it("remove CPF em texto solto", () => {
    expect(scrubText("não foi possível validar 123.456.789-00")).not.toContain("123.456.789-00");
  });

  it("remove CNPJ em texto solto", () => {
    expect(scrubText("fornecedor 11.222.333/0001-81 recusado")).not.toContain("11.222.333/0001-81");
  });

  it("remove e-mail em texto solto", () => {
    expect(scrubText("destino joao.souza@escola.com não existe")).not.toContain(
      "joao.souza@escola.com",
    );
  });

  it("mantém o que dá contexto em volta do documento", () => {
    const result = scrubText("não foi possível validar 123.456.789-00 do aluno");

    expect(result).toContain("não foi possível validar");
    expect(result).toContain("do aluno");
  });

  // O inverso disso quebraria o diagnóstico de todos os erros de data.
  it("não confunde número comum com documento", () => {
    expect(scrubText("processo 12345678901234")).toBe("processo 12345678901234");
  });
});

describe("scrubObject", () => {
  it("omite valor de campo cujo nome é credencial", () => {
    const result = scrubObject({
      email: "pessoa@escola.com",
      password: "segredo",
      token: "abc",
      cookie: "sess=1",
      authorization: "Bearer x",
    });

    expect(result["email"]).toBe(REDACTED_PLACEHOLDER);
    expect(result["password"]).toBe(REDACTED_PLACEHOLDER);
    expect(result["token"]).toBe(REDACTED_PLACEHOLDER);
    expect(result["cookie"]).toBe(REDACTED_PLACEHOLDER);
    expect(result["authorization"]).toBe(REDACTED_PLACEHOLDER);
  });

  it("omite documento e nome", () => {
    const result = scrubObject({
      cpf: "123.456.789-00",
      cnpj: "11.222.333/0001-81",
      nome: "Fulano",
    });

    expect(result["cpf"]).toBe(REDACTED_PLACEHOLDER);
    expect(result["cnpj"]).toBe(REDACTED_PLACEHOLDER);
    expect(result["nome"]).toBe(REDACTED_PLACEHOLDER);
  });

  it("mantém o que ajuda a diagnosticar", () => {
    const result = scrubObject({ routePath: "/catalogo/itens", status: 500, count: 12 });

    expect(result).toEqual({ routePath: "/catalogo/itens", status: 500, count: 12 });
  });

  it("desce em objeto aninhado", () => {
    const result = scrubObject({ req: { body: { password: "segredo", rota: "/x" } } });

    const body = (result["req"] as Record<string, unknown>)["body"] as Record<string, unknown>;

    expect(body["password"]).toBe(REDACTED_PLACEHOLDER);
    expect(body["rota"]).toBe("/x");
  });

  it("desce em array", () => {
    const result = scrubObject({ users: [{ cpf: "111" }, { cpf: "222" }] });
    const users = result["users"] as Array<Record<string, unknown>>;

    expect(users[0]?.["cpf"]).toBe(REDACTED_PLACEHOLDER);
    expect(users[1]?.["cpf"]).toBe(REDACTED_PLACEHOLDER);
  });

  it("limita array para não carregar payload gigante", () => {
    const result = scrubObject({ itens: Array.from({ length: 500 }, (_, i) => i) });

    expect((result["itens"] as unknown[]).length).toBe(50);
  });

  it("não entra em recursão infinita com objeto malformado", () => {
    const loop: Record<string, unknown> = { nome: "Fulano" };
    loop["self"] = loop;

    expect(() => scrubObject(loop)).not.toThrow();
  });
});

describe("scrubMessage", () => {
  it("omite a linha que parece conter credencial", () => {
    const stack = [
      "Error: falha ao autenticar",
      "  at auth (password=segredo123)",
      "  at handler",
    ].join("\n");

    const result = scrubMessage(stack);

    expect(result).not.toContain("segredo123");
    expect(result).toContain("falha ao autenticar");
    expect(result).toContain("at handler");
  });

  it("mantém a mensagem quando não há nada sensível", () => {
    expect(scrubMessage("TypeError: cannot read x")).toBe("TypeError: cannot read x");
  });

  it("marca a linha removida em vez de apagá-la em silêncio", () => {
    // Saber que havia uma segunda linha é diagnóstico; o sumiço se confunde com
    // "o erro veio em uma linha só".
    const result = scrubMessage("Falha no login\n  password=segredo\n  fim");

    expect(result).toContain(REDACTED_LINE);
    expect(result).not.toContain("segredo");
  });

  it("limita o número de linhas", () => {
    expect(
      scrubMessage(Array.from({ length: 500 }, () => "linha").join("\n")).split("\n").length,
    ).toBeLessThanOrEqual(60);
  });

  it("limita o tamanho", () => {
    expect(scrubMessage("a".repeat(5_000), 100).length).toBeLessThanOrEqual(101);
  });
});

describe("scrubPath", () => {
  it("tira a query string", () => {
    // Em relatório, a query carrega o filtro de pessoa.
    expect(scrubPath("/relatorios?nome=Joao&cpf=123")).toBe("/relatorios");
  });

  it("mantém caminho sem query", () => {
    expect(scrubPath("/catalogo/itens")).toBe("/catalogo/itens");
  });
});

describe("scrubHeaders", () => {
  it("remove cookie e autorização", () => {
    const result = scrubHeaders({
      Cookie: "sessao=abc",
      Authorization: "Bearer xyz",
      "x-api-key": "k",
      "user-agent": "PostmanRuntime",
    });

    expect(result).not.toHaveProperty("cookie");
    expect(result).not.toHaveProperty("authorization");
    expect(result).not.toHaveProperty("x-api-key");
  });

  it("mantém header inofensivo, que ajuda a diagnosticar", () => {
    const result = scrubHeaders({ "user-agent": "PostmanRuntime", accept: "text/html" });

    expect(result["user-agent"]).toBe("PostmanRuntime");
    expect(result["accept"]).toBe("text/html");
  });
});
