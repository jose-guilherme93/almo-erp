import { Prisma } from "@/generated/prisma/client";

/**
 * Custo médio ponderado.
 *
 * Função pura — é a regra contábil mais fácil de errar, então vive isolada e
 * coberta por teste (AGENTS.md §9).
 *
 *   novo = (qtd_atual × custo_atual + qtd_entrada × custo_entrada) / (qtd_atual + qtd_entrada)
 *
 * Casos de borda tratados:
 *   - entrada com quantidade zero: o custo não muda;
 *   - estoque zerado: o custo passa a ser o da entrada;
 *   - resultado negativo (ajuste de saída): custo permanece o atual.
 */

const MONEY_SCALE = 2;

export type AverageCostInput = {
  currentQuantity: Prisma.Decimal;
  currentAverageCost: Prisma.Decimal;
  incomingQuantity: Prisma.Decimal;
  incomingUnitCost: Prisma.Decimal;
};

export function computeAverageCost(input: AverageCostInput): Prisma.Decimal {
  const { currentQuantity, currentAverageCost, incomingQuantity, incomingUnitCost } = input;

  // Entrada sem quantidade não altera custo.
  if (incomingQuantity.isZero()) {
    return currentAverageCost.toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
  }

  // Ajuste negativo (quebra, perda): mantém o custo médio conhecido.
  if (incomingQuantity.isNegative()) {
    return currentAverageCost.toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
  }

  const newQuantity = currentQuantity.plus(incomingQuantity);

  // Atenção: `Decimal.isPositive()` devolve `true` para zero (o zero tem
  // sinal positivo). Comparar com zero explicitamente evita divisão por zero.
  if (!newQuantity.greaterThan(0)) {
    return new Prisma.Decimal(0);
  }

  const currentTotal = currentQuantity.times(currentAverageCost);
  const incomingTotal = incomingQuantity.times(incomingUnitCost);

  return currentTotal
    .plus(incomingTotal)
    .dividedBy(newQuantity)
    .toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/** Valor total de um conjunto de linhas (`quantidade × custo unitário`). */
export function computeLineTotal(
  quantity: Prisma.Decimal,
  unitCost: Prisma.Decimal,
): Prisma.Decimal {
  return quantity.abs().times(unitCost).toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/** Soma de quantidades assinadas de um documento. */
export function sumQuantities(quantities: readonly Prisma.Decimal[]): Prisma.Decimal {
  return quantities.reduce((total, quantity) => total.plus(quantity), new Prisma.Decimal(0));
}

/** Soma de valores de um documento. */
export function sumTotals(totals: readonly Prisma.Decimal[]): Prisma.Decimal {
  return totals
    .reduce((total, value) => total.plus(value), new Prisma.Decimal(0))
    .toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/** Disponível = quantidade − reservada. Nunca negativo por construção. */
export function availableQuantity(
  quantity: Prisma.Decimal,
  reservedQuantity: Prisma.Decimal,
): Prisma.Decimal {
  const available = quantity.minus(reservedQuantity);

  return available.isNegative() ? new Prisma.Decimal(0) : available;
}
