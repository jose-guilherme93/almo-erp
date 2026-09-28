import { describe, expect, it } from "vitest";

import {
  ACCESS_DENY_MESSAGES,
  type EmailPolicyRule,
  evaluateCorporateEmail,
  extractDomain,
  isAccessDenyReason,
  isCorporateDomain,
  isValidEmailShape,
  isValidPattern,
  matchesEmailPattern,
  normalizeEmail,
} from "@/lib/email-policy";

function policy(overrides: Partial<EmailPolicyRule> = {}): EmailPolicyRule {
  return {
    domain: "exemplo.com.br",
    pattern: null,
    autoApprove: false,
    active: true,
    ...overrides,
  };
}

describe("normalizeEmail / isValidEmailShape / extractDomain", () => {
  it("normaliza caixa e espaços", () => {
    expect(normalizeEmail("  Foo@Exemplo.COM.BR  ")).toBe("foo@exemplo.com.br");
  });

  it("aceita formatos válidos", () => {
    expect(isValidEmailShape("a@b.com")).toBe(true);
    expect(isValidEmailShape("nome.sobrenome@empresa.com.br")).toBe(true);
    expect(isValidEmailShape("nome+filialsp@empresa.com.br")).toBe(true);
  });

  it("rejeita formatos inválidos", () => {
    for (const invalid of [
      "",
      "sem-arroba",
      "@semlocal.com",
      "sem@dominio",
      "a b@c.com",
      "a@b.c",
    ]) {
      expect(isValidEmailShape(invalid)).toBe(false);
    }
  });

  it("extrai o domínio", () => {
    expect(extractDomain("Foo@Exemplo.com.br")).toBe("exemplo.com.br");
  });

  it("devolve null para e-mail inválido", () => {
    expect(extractDomain("sem-arroba")).toBeNull();
  });
});

describe("isCorporateDomain", () => {
  it("aceita domínio vindo do ambiente", () => {
    expect(isCorporateDomain("exemplo.com.br", ["exemplo.com.br"], [])).toBe(true);
  });

  it("aceita domínio vindo de política ativa do banco", () => {
    expect(isCorporateDomain("empresa.com", [], [policy({ domain: "empresa.com" })])).toBe(true);
  });

  it("ignora política inativa", () => {
    expect(
      isCorporateDomain("empresa.com", [], [policy({ domain: "empresa.com", active: false })]),
    ).toBe(false);
  });

  it("ignora diferença de caixa e espaços", () => {
    expect(isCorporateDomain(" Exemplo.COM.BR ", ["exemplo.com.br"], [])).toBe(true);
  });

  it("rejeita domínio pessoal", () => {
    expect(isCorporateDomain("gmail.com", ["exemplo.com.br"], [])).toBe(false);
    expect(isCorporateDomain("hotmail.com", ["exemplo.com.br"], [])).toBe(false);
    expect(isCorporateDomain("outlook.com", ["exemplo.com.br"], [])).toBe(false);
  });

  it("rejeita quando não há fonte alguma configurada", () => {
    expect(isCorporateDomain("exemplo.com.br", [], [])).toBe(false);
  });
});

describe("matchesEmailPattern", () => {
  it("sem pattern, qualquer e-mail passa", () => {
    expect(matchesEmailPattern("qualquer@exemplo.com.br", null)).toBe(true);
  });

  it("casa um pattern válido", () => {
    expect(matchesEmailPattern("joao+filialsp@exemplo.com.br", "^.+\\+filial[a-z]+@")).toBe(true);
    expect(matchesEmailPattern("joao@exemplo.com.br", "^.+\\+filial[a-z]+@")).toBe(false);
  });

  it("pattern inválida nunca libera acesso", () => {
    expect(matchesEmailPattern("joao@exemplo.com.br", "([a-z")).toBe(false);
  });

  it("isValidPattern distingue regex válida de inválida", () => {
    expect(isValidPattern("^a+$")).toBe(true);
    expect(isValidPattern("([a-z")).toBe(false);
  });
});

describe("evaluateCorporateEmail", () => {
  const env = ["exemplo.com.br"];
  const policies = [policy()];

  it("aprova e-mail corporativo válido", () => {
    const result = evaluateCorporateEmail("Joao@Exemplo.com.br", env, policies);

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.matchedPolicy?.domain).toBe("exemplo.com.br");
    }
  });

  it("nega e-mail pessoal com motivo domain-not-allowed", () => {
    const result = evaluateCorporateEmail("joao@gmail.com", env, policies);

    expect(result).toEqual({ allowed: false, reason: "domain-not-allowed" });
  });

  it("nega formato inválido", () => {
    const result = evaluateCorporateEmail("nao-e-email", env, policies);

    expect(result).toEqual({ allowed: false, reason: "invalid-shape" });
  });

  it("nega quando a política tem pattern e ele não casa", () => {
    const withPattern = [policy({ pattern: "^.+\\+filial[a-z]+@" })];
    const result = evaluateCorporateEmail("joao@exemplo.com.br", env, withPattern);

    expect(result).toEqual({ allowed: false, reason: "pattern-mismatch" });
  });

  it("aprova quando a política tem pattern e ele casa", () => {
    const withPattern = [policy({ pattern: "^.+\\+filial[a-z]+@" })];
    const result = evaluateCorporateEmail("joao+filialsp@exemplo.com.br", env, withPattern);

    expect(result.allowed).toBe(true);
  });

  it("domínio só no ambiente (sem política) continua aprovando", () => {
    const result = evaluateCorporateEmail("joao@outra.com.br", ["outra.com.br"], []);

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.matchedPolicy).toBeNull();
    }
  });

  it("devolve a política que autorizou, para decidir autoApprove", () => {
    const result = evaluateCorporateEmail(
      "joao@empresa.com",
      [],
      [policy({ domain: "empresa.com", autoApprove: true })],
    );

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.matchedPolicy?.autoApprove).toBe(true);
    }
  });
});

describe("mensagens de negativa", () => {
  it("cobre todos os motivos com texto em português", () => {
    for (const message of Object.values(ACCESS_DENY_MESSAGES)) {
      expect(message.length).toBeGreaterThan(10);
      expect(message).toMatch(/[áéíóúâêôãõç]|aprova|acesso|e-mail/i);
    }
  });

  it("isAccessDenyReason valida corretamente", () => {
    expect(isAccessDenyReason("domain-not-allowed")).toBe(true);
    expect(isAccessDenyReason("awaiting-approval")).toBe(true);
    expect(isAccessDenyReason("qualquer-coisa")).toBe(false);
  });
});
