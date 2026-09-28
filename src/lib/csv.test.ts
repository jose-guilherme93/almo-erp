import { describe, expect, it } from "vitest";

import { csvFileName, escapeCsvValue, resolvePreset, toCsv, toCsvNumber } from "@/lib/csv";

describe("escapeCsvValue", () => {
  it("devolve vazio para nulo e indefinido", () => {
    expect(escapeCsvValue(null)).toBe("");
    expect(escapeCsvValue(undefined)).toBe("");
  });

  it("escapa o separador entre aspas", () => {
    expect(escapeCsvValue("papel; A4")).toBe('"papel; A4"');
  });

  it("duplica aspas existentes", () => {
    expect(escapeCsvValue('copo "grande"')).toBe('"copo ""grande"""');
  });

  it("escapa quebra de linha", () => {
    expect(escapeCsvValue("linha1\nlinha2")).toBe('"linha1\nlinha2"');
  });

  it("converte objeto (Decimal do Prisma) para texto", () => {
    expect(escapeCsvValue({ toString: () => "12.50" })).toBe("12.50");
  });
});

describe("toCsv", () => {
  it("inclui BOM UTF-8 e usa ponto e vírgula", () => {
    const csv = toCsv(["Nome", "Quantidade"], [["Água sanitária", "10"]]);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Nome;Quantidade");
    expect(csv).toContain("Água sanitária;10");
  });

  it("separa linhas com CRLF", () => {
    const csv = toCsv(["A"], [["1"], ["2"]]);

    expect(csv).toContain("\r\n");
  });

  it("escapa campos por linha", () => {
    const csv = toCsv(["Nome"], [["papel; A4"]]);

    expect(csv).toContain('"papel; A4"');
  });
});

describe("toCsvNumber", () => {
  it("troca o ponto decimal pela vírgula", () => {
    expect(toCsvNumber("12.5")).toBe("12,5");
  });

  it("mantém inteiro como está", () => {
    expect(toCsvNumber(10)).toBe("10");
  });
});

describe("csvFileName", () => {
  it("monta um nome previsível com o período", () => {
    expect(
      csvFileName({ report: "Consumo por material", from: "2026-01-01", to: "2026-01-31" }),
    ).toBe("consumo-por-material-2026-01-01-2026-01-31.csv");
  });

  it("remove acentos e caracteres especiais", () => {
    expect(csvFileName({ report: "Movimentações (extrato)", suffix: "FIL-SP" })).toBe(
      "movimentacoes-extrato-fil-sp.csv",
    );
  });

  it("usa um nome padrão quando não há partes", () => {
    expect(csvFileName({ report: "" })).toBe("relatorio.csv");
  });
});

describe("resolvePreset", () => {
  const reference = new Date("2026-09-15T12:00:00Z");

  it("resolve o mês atual", () => {
    const period = resolvePreset("mes", reference);

    expect(period.from).toBe("2026-09-01");
    expect(period.to).toBe("2026-09-15");
  });

  it("resolve o mês anterior", () => {
    const period = resolvePreset("mes-anterior", reference);

    expect(period.from).toBe("2026-08-01");
    expect(period.to).toBe("2026-08-31");
  });

  it("resolve o ano atual", () => {
    const period = resolvePreset("ano", reference);

    expect(period.from).toBe("2026-01-01");
  });

  it("devolve intervalo válido para os presets de dias", () => {
    for (const preset of ["30d", "90d"] as const) {
      const period = resolvePreset(preset, reference);

      expect(new Date(period.from).getTime()).toBeLessThan(new Date(period.to).getTime());
    }
  });
});
