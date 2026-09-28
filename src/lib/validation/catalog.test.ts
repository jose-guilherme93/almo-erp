import { describe, expect, it } from "vitest";

import {
  categorySchema,
  isValidBarcode,
  itemSchema,
  itemStockPolicySchema,
  unitSchema,
} from "@/lib/validation/catalog";

describe("isValidBarcode", () => {
  it("aceita EAN-13 com dígito verificador correto", () => {
    // Códigos usados no seed de demonstração.
    expect(isValidBarcode("7891234500014")).toBe(true);
    expect(isValidBarcode("7891234500151")).toBe(true);
  });

  it("rejeita EAN-13 com dígito verificador errado", () => {
    expect(isValidBarcode("7891234500017")).toBe(false);
    expect(isValidBarcode("7891234500010")).toBe(false);
  });

  it("aceita EAN-8, UPC-12 e GTIN-14 válidos", () => {
    expect(isValidBarcode("96385074")).toBe(true); // EAN-8
    expect(isValidBarcode("036000291452")).toBe(true); // UPC-A
    expect(isValidBarcode("10012345000017")).toBe(true); // GTIN-14
  });

  it("rejeita tamanhos não suportados", () => {
    for (const invalid of ["", "1", "1234567", "123456789", "12345678901"]) {
      expect(isValidBarcode(invalid)).toBe(false);
    }
  });

  it("ignora a máscara ao validar", () => {
    expect(isValidBarcode("789 1234 500014")).toBe(true);
  });
});

describe("unitSchema", () => {
  it("normaliza o código para maiúsculas", () => {
    const parsed = unitSchema.parse({
      code: "cx",
      name: "Caixa",
      allowsDecimals: false,
      active: true,
    });

    expect(parsed.code).toBe("CX");
  });

  it("rejeita código com caractere inválido", () => {
    const result = unitSchema.safeParse({
      code: "C X!",
      name: "Caixa",
      allowsDecimals: false,
      active: true,
    });

    expect(result.success).toBe(false);
  });
});

describe("categorySchema", () => {
  it("aceita categoria raiz sem pai", () => {
    const result = categorySchema.safeParse({
      code: "EPI",
      name: "Equipamento de proteção",
      requiresApproval: true,
      active: true,
    });

    expect(result.success).toBe(true);
  });
});

describe("itemSchema", () => {
  const base = {
    name: "Capacete de segurança",
    categoryId: "cat-1",
    unitId: "unit-1",
    referencePrice: 48.9,
    controlledByLot: false,
    perishable: false,
    requiresApproval: false,
    hasSerialControl: false,
    active: true,
  };

  it("aceita item válido sem código (gerado depois)", () => {
    const result = itemSchema.safeParse(base);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.code).toBeUndefined();
  });

  it("rejeita código de barras com dígito verificador errado", () => {
    const result = itemSchema.safeParse({ ...base, barcode: "7891234500017" });

    expect(result.success).toBe(false);
  });

  it("aceita código de barras válido", () => {
    const result = itemSchema.safeParse({ ...base, barcode: "7891234500014" });

    expect(result.success).toBe(true);
  });

  it("exige controle por lote para material perecível", () => {
    const result = itemSchema.safeParse({ ...base, perishable: true, controlledByLot: false });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain("controlledByLot");
    }
  });

  it("aceita perecível com controle por lote", () => {
    const result = itemSchema.safeParse({ ...base, perishable: true, controlledByLot: true });

    expect(result.success).toBe(true);
  });

  it("rejeita preço negativo", () => {
    const result = itemSchema.safeParse({ ...base, referencePrice: -1 });

    expect(result.success).toBe(false);
  });
});

describe("itemStockPolicySchema", () => {
  it("aceita política com uma unidade", () => {
    const result = itemStockPolicySchema.safeParse({
      itemId: "item-1",
      branchIds: ["branch-1"],
      minimumQuantity: 10,
    });

    expect(result.success).toBe(true);
  });

  it("rejeita política sem unidade", () => {
    const result = itemStockPolicySchema.safeParse({
      itemId: "item-1",
      branchIds: [],
      minimumQuantity: 10,
    });

    expect(result.success).toBe(false);
  });

  it("rejeita máximo menor que o mínimo", () => {
    const result = itemStockPolicySchema.safeParse({
      itemId: "item-1",
      branchIds: ["branch-1"],
      minimumQuantity: 10,
      maximumQuantity: 5,
    });

    expect(result.success).toBe(false);
  });

  it("aceita máximo igual ao mínimo", () => {
    const result = itemStockPolicySchema.safeParse({
      itemId: "item-1",
      branchIds: ["branch-1"],
      minimumQuantity: 10,
      maximumQuantity: 10,
    });

    expect(result.success).toBe(true);
  });
});
