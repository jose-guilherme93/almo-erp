import { describe, expect, it } from "vitest";

import { mapBrasilApiCnpj } from "@/lib/cnpj";

/** Trecho real da BrasilAPI (`/api/cnpj/v1/{cnpj}`), reduzido ao que usamos. */
const BRASIL_API_PAYLOAD = {
  cnpj: "19131243000197",
  razao_social: "OPEN KNOWLEDGE BRASIL",
  nome_fantasia: "REDE PELO CONHECIMENTO LIVRE",
  cnae_fiscal: 6201501,
  cnae_fiscal_descricao: "Desenvolvimento de programas de computador sob encomenda",
  cep: "01310200",
  logradouro: "AVENIDA PAULISTA",
  numero: "37",
  complemento: "ANDAR 4 CONJ 41",
  bairro: "BELA VISTA",
  municipio: "SAO PAULO",
  uf: "SP",
};

describe("mapBrasilApiCnpj", () => {
  it("traduz o payload da BrasilAPI para os campos do cadastro", () => {
    expect(mapBrasilApiCnpj(BRASIL_API_PAYLOAD)).toEqual({
      cnpj: "19131243000197",
      legalName: "OPEN KNOWLEDGE BRASIL",
      tradeName: "REDE PELO CONHECIMENTO LIVRE",
      cnae: "6201501",
      zipCode: "01310200",
      street: "AVENIDA PAULISTA",
      number: "37",
      complement: "ANDAR 4 CONJ 41",
      district: "BELA VISTA",
      city: "SAO PAULO",
      state: "SP",
    });
  });

  it("normaliza CEP, CNAE e UF com pontuação/acentuação de origem", () => {
    const mapped = mapBrasilApiCnpj({
      cnpj: "19.131.243/0001-97",
      razao_social: "Empresa Teste",
      cnae_fiscal: "62.01-5-01",
      cep: "01310-200",
      uf: "sp",
    });

    expect(mapped?.cnpj).toBe("19131243000197");
    expect(mapped?.cnae).toBe("6201501");
    expect(mapped?.zipCode).toBe("01310200");
    expect(mapped?.state).toBe("SP");
  });

  it("devolve null quando falta razão social ou CNPJ", () => {
    expect(mapBrasilApiCnpj({ razao_social: "Sem CNPJ" })).toBeNull();
    expect(mapBrasilApiCnpj({ cnpj: "19131243000197" })).toBeNull();
  });

  it("devolve null para payload que não é objeto", () => {
    expect(mapBrasilApiCnpj(null)).toBeNull();
    expect(mapBrasilApiCnpj("texto")).toBeNull();
    expect(mapBrasilApiCnpj(42)).toBeNull();
  });

  it("aceita campos opcionais ausentes", () => {
    const mapped = mapBrasilApiCnpj({
      cnpj: "19131243000197",
      razao_social: "Empresa Mínima",
    });

    expect(mapped).toMatchObject({
      legalName: "Empresa Mínima",
      tradeName: null,
      cnae: null,
      city: null,
      state: null,
    });
  });
});
