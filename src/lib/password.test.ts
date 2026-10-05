import { describe, expect, it } from "vitest";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  burnPasswordCheckTime,
  hashPassword,
  isAcceptablePassword,
  verifyPassword,
} from "@/lib/password";

describe("hashPassword / verifyPassword", () => {
  it("aceita a senha correta e recusa a errada", async () => {
    const hash = await hashPassword("senha-super-secreta");

    expect(await verifyPassword("senha-super-secreta", hash)).toBe(true);
    expect(await verifyPassword("senha-super-secret4", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("gera hashes diferentes para a mesma senha (salt aleatório)", async () => {
    const a = await hashPassword("mesma-senha");
    const b = await hashPassword("mesma-senha");

    expect(a).not.toBe(b);
    expect(await verifyPassword("mesma-senha", a)).toBe(true);
    expect(await verifyPassword("mesma-senha", b)).toBe(true);
  });

  it("usa o formato `scrypt$salt$hash`", async () => {
    const hash = await hashPassword("qualquer-coisa");
    const parts = hash.split("$");

    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("scrypt");
  });

  it("recusa hashes malformados sem lançar", async () => {
    for (const malformed of [
      "",
      "texto-puro",
      "scrypt$salt",
      "bcrypt$c2FsdA==$aGFzaA==",
      "$",
      "a$b$c",
    ]) {
      await expect(verifyPassword("senha", malformed)).resolves.toBe(false);
    }
  });
});

describe("isAcceptablePassword", () => {
  it("exige o tamanho mínimo", () => {
    expect(isAcceptablePassword("a".repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false);
    expect(isAcceptablePassword("a".repeat(PASSWORD_MIN_LENGTH))).toBe(true);
  });

  it("respeita o teto defensivo", () => {
    expect(isAcceptablePassword("a".repeat(PASSWORD_MAX_LENGTH))).toBe(true);
    expect(isAcceptablePassword("a".repeat(PASSWORD_MAX_LENGTH + 1))).toBe(false);
  });
});

describe("burnPasswordCheckTime", () => {
  it("resolve sem lançar", async () => {
    await expect(burnPasswordCheckTime("qualquer-senha")).resolves.toBeUndefined();
  });
});
