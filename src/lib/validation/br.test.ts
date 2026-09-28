import { describe, expect, it } from "vitest";

import {
  isValidCnpj,
  isValidCpf,
  isValidPhone,
  isValidZipCode,
  isUf,
  normalizeCnpj,
  normalizePhone,
} from "@/lib/validation/br";

describe("isValidCnpj", () => {
  it("aceita CNPJ válido, com e sem máscara", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
  });

  it("rejeita CNPJ com dígito verificador errado", () => {
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(isValidCnpj("11.222.333/0001-00")).toBe(false);
  });

  it("rejeita números repetidos", () => {
    for (const repeated of ["00000000000000", "11111111111111", "99999999999999"]) {
      expect(isValidCnpj(repeated)).toBe(false);
    }
  });

  it("rejeita tamanho errado e entrada vazia", () => {
    expect(isValidCnpj("1122233300018")).toBe(false);
    expect(isValidCnpj("112223330001811")).toBe(false);
    expect(isValidCnpj("")).toBe(false);
    expect(isValidCnpj("abc")).toBe(false);
  });
});

describe("isValidCpf", () => {
  it("aceita CPF válido", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
  });

  it("rejeita CPF inválido e repetido", () => {
    expect(isValidCpf("52998224724")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
  });
});

describe("isValidZipCode", () => {
  it("aceita CEP com 8 dígitos", () => {
    expect(isValidZipCode("01310-100")).toBe(true);
    expect(isValidZipCode("01310100")).toBe(true);
  });

  it("rejeita tamanho diferente", () => {
    expect(isValidZipCode("0131010")).toBe(false);
    expect(isValidZipCode("013101000")).toBe(false);
  });
});

describe("isValidPhone", () => {
  it("aceita fixo e celular com DDD", () => {
    expect(isValidPhone("(11) 3333-4444")).toBe(true);
    expect(isValidPhone("(11) 99999-8888")).toBe(true);
    expect(isValidPhone("1133334444")).toBe(true);
  });

  it("rejeita celular que não começa com 9", () => {
    expect(isValidPhone("11888888888")).toBe(false);
  });

  it("rejeita DDD inválido", () => {
    expect(isValidPhone("0133334444")).toBe(false);
    expect(isValidPhone("0033334444")).toBe(false);
  });

  it("rejeita quantidade de dígitos errada", () => {
    expect(isValidPhone("33334444")).toBe(false);
    expect(isValidPhone("119999988887")).toBe(false);
  });
});

describe("normalizePhone", () => {
  it("devolve E.164 para telefone válido", () => {
    expect(normalizePhone("(11) 99999-8888")).toBe("+5511999998888");
  });

  it("devolve null para telefone inválido", () => {
    expect(normalizePhone("123")).toBeNull();
  });
});

describe("isUf", () => {
  it("aceita as 27 unidades federativas", () => {
    for (const uf of ["SP", "RJ", "MG", "DF", "AC", "TO"]) {
      expect(isUf(uf)).toBe(true);
    }
  });

  it("é insensível a caixa", () => {
    expect(isUf("sp")).toBe(true);
  });

  it("rejeita sigla inexistente", () => {
    expect(isUf("XX")).toBe(false);
    expect(isUf("SAO")).toBe(false);
  });
});

describe("normalizeCnpj", () => {
  it("remove a máscara", () => {
    expect(normalizeCnpj("11.222.333/0001-81")).toBe("11222333000181");
  });
});
