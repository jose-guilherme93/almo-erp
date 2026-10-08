import { describe, expect, it } from "vitest";

import type { AssetStatus } from "@/generated/prisma/enums";
import { canTransitionAsset } from "./transitions";

const ALL: readonly AssetStatus[] = ["IN_STOCK", "IN_USE", "IN_MAINTENANCE", "RETIRED"];

describe("máquina de estados do patrimônio", () => {
  it("permite atribuir e devolver", () => {
    expect(canTransitionAsset("IN_STOCK", "IN_USE")).toBe(true);
    expect(canTransitionAsset("IN_USE", "IN_STOCK")).toBe(true);
  });

  it("permite enviar para manutenção e voltar", () => {
    expect(canTransitionAsset("IN_STOCK", "IN_MAINTENANCE")).toBe(true);
    expect(canTransitionAsset("IN_MAINTENANCE", "IN_STOCK")).toBe(true);
    expect(canTransitionAsset("IN_USE", "IN_MAINTENANCE")).toBe(true);
  });

  it("permite dar baixa de qualquer estado ativo", () => {
    expect(canTransitionAsset("IN_STOCK", "RETIRED")).toBe(true);
    expect(canTransitionAsset("IN_USE", "RETIRED")).toBe(true);
    expect(canTransitionAsset("IN_MAINTENANCE", "RETIRED")).toBe(true);
  });

  it("RETIRED é terminal", () => {
    for (const status of ALL) {
      expect(canTransitionAsset("RETIRED", status)).toBe(false);
    }
  });

  it("não reatribui um bem já em uso", () => {
    expect(canTransitionAsset("IN_USE", "IN_USE")).toBe(false);
  });
});
