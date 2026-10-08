import type { AssetStatus } from "@/generated/prisma/enums";
import { InvalidTransitionError } from "@/lib/errors";

/**
 * Máquina de estados do patrimônio (AGENTS.md §3.4).
 *
 * `RETIRED` é terminal. `IN_USE` é **posse**, não propriedade: o bem continua
 * sendo da unidade e volta ao almoxarifado quando o responsável é desligado.
 * Nenhuma transição mexe em `StockLevel` — a posse não é saída de estoque.
 */
export const ASSET_TRANSITIONS: Record<AssetStatus, readonly AssetStatus[]> = {
  IN_STOCK: ["IN_USE", "IN_MAINTENANCE", "RETIRED"],
  IN_USE: ["IN_STOCK", "IN_MAINTENANCE", "RETIRED"],
  IN_MAINTENANCE: ["IN_STOCK", "IN_USE", "RETIRED"],
  RETIRED: [],
};

export function canTransitionAsset(from: AssetStatus, to: AssetStatus): boolean {
  return ASSET_TRANSITIONS[from].includes(to);
}

export function assertAssetTransition(from: AssetStatus, to: AssetStatus): void {
  if (!canTransitionAsset(from, to)) {
    throw new InvalidTransitionError(from, to, "o patrimônio");
  }
}
