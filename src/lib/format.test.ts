import { describe, expect, it } from "vitest";

import {
  formatCnpj,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDuration,
  formatPhone,
  formatQuantity,
  formatRelative,
  formatZipCode,
  onlyDigits,
} from "@/lib/format";

describe("formatCurrency", () => {
  // O Intl do pt-BR usa espaço não separável (U+00A0) depois de "R$".
  const NBSP = "\u00A0";

  it("formata string decimal do banco", () => {
    // O Prisma devolve Decimal; o formato de chegada é string.
    expect(formatCurrency("1234.5")).toBe(`R$${NBSP}1.234,50`);
    expect(formatCurrency("0")).toBe(`R$${NBSP}0,00`);
    expect(formatCurrency("1234567.891")).toBe(`R$${NBSP}1.234.567,89`);
  });

  it("aceita objeto com toString (Decimal do Prisma)", () => {
    expect(formatCurrency({ toString: () => "99.9" })).toBe(`R$${NBSP}99,90`);
  });

  it("devolve travessão para valor inválido", () => {
    expect(formatCurrency("abc")).toBe("—");
  });
});

describe("formatQuantity", () => {
  it("remove zeros à direita", () => {
    expect(formatQuantity("12.0000")).toBe("12");
    expect(formatQuantity("12.5000")).toBe("12,5");
  });

  it("preserva a precisão informada", () => {
    expect(formatQuantity("0.1250")).toBe("0,125");
  });

  it("formata milhar", () => {
    expect(formatQuantity("1234")).toBe("1.234");
  });
});

describe("formatDate e formatDateTime", () => {
  it("usa o fuso de operação (America/Sao_Paulo)", () => {
    // 2026-09-28T12:00:00Z é 09:00 em São Paulo (UTC-3).
    expect(formatDateTime("2026-09-28T12:00:00Z")).toBe("28/09/2026 09:00");
    expect(formatDate("2026-09-28T12:00:00Z")).toBe("28/09/2026");
  });

  it("não estoura a virada de dia", () => {
    // 2026-09-29T01:30:00Z é 28/09 às 22:30 em São Paulo.
    expect(formatDate("2026-09-29T01:30:00Z")).toBe("28/09/2026");
  });
});

describe("formatRelative", () => {
  const base = new Date("2026-09-28T12:00:00Z");

  it("descreve o passado", () => {
    expect(formatRelative("2026-09-28T09:00:00Z", base)).toBe("há 3 horas");
  });

  it("descreve o futuro", () => {
    expect(formatRelative("2026-09-30T12:00:00Z", base)).toBe("depois de amanhã");
    expect(formatRelative("2026-10-05T12:00:00Z", base)).toBe("em 7 dias");
  });

  it("não quebra com valor inválido", () => {
    expect(formatRelative("data-invalida", base)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("usa dias e horas quando passa de 24h", () => {
    expect(formatDuration(52)).toBe("2 d 4 h");
  });

  it("usa horas e minutos no mesmo dia", () => {
    expect(formatDuration(5.5)).toBe("5 h 30 min");
  });

  it("usa apenas minutos abaixo de 1h", () => {
    expect(formatDuration(0.5)).toBe("30 min");
  });

  it("não quebra com valor inválido", () => {
    expect(formatDuration(-1)).toBe("—");
  });
});

describe("máscaras", () => {
  it("formata CNPJ", () => {
    expect(formatCnpj("12345678000199")).toBe("12.345.678/0001-99");
  });

  it("devolve o valor original se o CNPJ não tiver 14 dígitos", () => {
    expect(formatCnpj("123")).toBe("123");
  });

  it("formata CEP", () => {
    expect(formatZipCode("01310100")).toBe("01310-100");
  });

  it("formata telefone fixo e celular", () => {
    expect(formatPhone("1133334444")).toBe("(11) 3333-4444");
    expect(formatPhone("11999998888")).toBe("(11) 99999-8888");
  });

  it("remove tudo que não é dígito", () => {
    expect(onlyDigits("12.345.678/0001-99")).toBe("12345678000199");
  });
});
