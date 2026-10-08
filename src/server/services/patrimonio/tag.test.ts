import { describe, expect, it } from "vitest";

import { formatAssetTag, formatAssetTagLabel, parseAssetTag } from "./tag";

describe("etiqueta de patrimônio", () => {
  it("monta a etiqueta com o sequencial preenchido", () => {
    expect(formatAssetTag(1)).toBe("PAT-000001");
    expect(formatAssetTag(123)).toBe("PAT-000123");
  });

  it("extrai o sequencial da etiqueta", () => {
    expect(parseAssetTag("PAT-000123")).toBe(123);
    expect(parseAssetTag(" PAT-000001 ")).toBe(1);
  });

  it("recusa formato que não é etiqueta", () => {
    expect(parseAssetTag("123")).toBeNull();
    expect(parseAssetTag("BEM-001")).toBeNull();
  });

  it("apresenta a etiqueta de forma legível para humanos", () => {
    expect(formatAssetTagLabel("PAT-000123")).toBe("PAT 000 123");
    expect(formatAssetTagLabel("PAT-000001")).toBe("PAT 000 001");
  });

  it("devolve o valor original quando não reconhece a etiqueta", () => {
    expect(formatAssetTagLabel("sem-formato")).toBe("sem-formato");
  });
});
