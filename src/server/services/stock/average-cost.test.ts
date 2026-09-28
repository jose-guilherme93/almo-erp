import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import {
  availableQuantity,
  computeAverageCost,
  computeLineTotal,
  sumQuantities,
  sumTotals,
} from "@/server/services/stock/average-cost";

const d = (value: string | number) => new Prisma.Decimal(value);

describe("computeAverageCost", () => {
  it("usa o custo da entrada quando o estoque está zerado", () => {
    const result = computeAverageCost({
      currentQuantity: d(0),
      currentAverageCost: d(0),
      incomingQuantity: d(10),
      incomingUnitCost: d(5),
    });

    expect(result.toString()).toBe("5");
  });

  it("pondera entre o estoque atual e a entrada", () => {
    // 10 un a 5,00 + 10 un a 7,00 = 120 / 20 = 6,00
    const result = computeAverageCost({
      currentQuantity: d(10),
      currentAverageCost: d(5),
      incomingQuantity: d(10),
      incomingUnitCost: d(7),
    });

    expect(result.toString()).toBe("6");
  });

  it("arredonda para 2 casas", () => {
    // 3 un a 10,00 + 1 un a 12,00 = 42 / 4 = 10,50
    const result = computeAverageCost({
      currentQuantity: d(3),
      currentAverageCost: d(10),
      incomingQuantity: d(1),
      incomingUnitCost: d(12),
    });

    expect(result.toString()).toBe("10.5");
  });

  it("não altera o custo em entrada de quantidade zero", () => {
    const result = computeAverageCost({
      currentQuantity: d(10),
      currentAverageCost: d(4.2),
      incomingQuantity: d(0),
      incomingUnitCost: d(99),
    });

    expect(result.toString()).toBe("4.2");
  });

  it("mantém o custo em ajuste negativo", () => {
    const result = computeAverageCost({
      currentQuantity: d(10),
      currentAverageCost: d(6),
      incomingQuantity: d(-3),
      incomingUnitCost: d(0),
    });

    expect(result.toString()).toBe("6");
  });

  it("mantém o último custo conhecido quando não há saldo", () => {
    // Saldo zero com custo preservado é inofensivo (0 × custo = 0) e evita
    // perder o histórico de custo entre uma saída total e a próxima entrada.
    const result = computeAverageCost({
      currentQuantity: d(0),
      currentAverageCost: d(6),
      incomingQuantity: d(0),
      incomingUnitCost: d(0),
    });

    expect(result.toString()).toBe("6");
  });

  it("lida com quantidade fracionada", () => {
    // 2,5 kg a 10,00 + 0,5 kg a 14,00 = 32 / 3 = 10,67
    const result = computeAverageCost({
      currentQuantity: d("2.5"),
      currentAverageCost: d(10),
      incomingQuantity: d("0.5"),
      incomingUnitCost: d(14),
    });

    expect(result.toString()).toBe("10.67");
  });
});

describe("computeLineTotal", () => {
  it("usa o valor absoluto da quantidade (saída tem sinal negativo)", () => {
    expect(computeLineTotal(d(-3), d(10)).toString()).toBe("30");
    expect(computeLineTotal(d(3), d(10)).toString()).toBe("30");
  });

  it("arredonda para 2 casas", () => {
    expect(computeLineTotal(d("1.333"), d("3.33")).toString()).toBe("4.44");
  });
});

describe("sumQuantities e sumTotals", () => {
  it("soma quantidades assinadas", () => {
    expect(sumQuantities([d(10), d(-3), d(-2)]).toString()).toBe("5");
  });

  it("soma valores", () => {
    expect(sumTotals([d("10.33"), d("2.67")]).toString()).toBe("13");
  });

  it("devolve zero para lista vazia", () => {
    expect(sumQuantities([]).toString()).toBe("0");
    expect(sumTotals([]).toString()).toBe("0");
  });
});

describe("availableQuantity", () => {
  it("desconta o reservado", () => {
    expect(availableQuantity(d(10), d(4)).toString()).toBe("6");
  });

  it("nunca devolve negativo", () => {
    expect(availableQuantity(d(2), d(5)).toString()).toBe("0");
  });
});
