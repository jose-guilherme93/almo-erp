import { describe, expect, it } from "vitest";

import {
  EMPTY_THROTTLE,
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_ATTEMPTS,
  isThrottleLocked,
  remainingLockMinutes,
  throttleAfterFailure,
  type ThrottleSnapshot,
} from "@/lib/login-throttle";

const NOW = new Date("2026-09-30T12:00:00.000Z");

function snapshot(overrides: Partial<ThrottleSnapshot> = {}): ThrottleSnapshot {
  return { ...EMPTY_THROTTLE, ...overrides };
}

describe("isThrottleLocked", () => {
  it("não está bloqueado sem lock", () => {
    expect(isThrottleLocked(snapshot(), NOW)).toBe(false);
  });

  it("está bloqueado enquanto o lock está no futuro", () => {
    const locked = snapshot({ lockedUntil: new Date(NOW.getTime() + 60_000) });
    expect(isThrottleLocked(locked, NOW)).toBe(true);
  });

  it("não está bloqueado depois do lock vencer", () => {
    const expired = snapshot({ lockedUntil: new Date(NOW.getTime() - 1) });
    expect(isThrottleLocked(expired, NOW)).toBe(false);
  });
});

describe("throttleAfterFailure", () => {
  it("incrementa o contador e não bloqueia antes do limite", () => {
    let state = snapshot();

    for (let attempt = 1; attempt < LOGIN_MAX_ATTEMPTS; attempt++) {
      state = throttleAfterFailure(state, NOW);

      expect(state.failedCount).toBe(attempt);
      expect(state.lockedUntil).toBeNull();
    }
  });

  it("bloqueia exatamente ao atingir o limite", () => {
    let state = snapshot();

    for (let attempt = 0; attempt < LOGIN_MAX_ATTEMPTS; attempt++) {
      state = throttleAfterFailure(state, NOW);
    }

    expect(state.failedCount).toBe(LOGIN_MAX_ATTEMPTS);
    expect(state.lockedUntil?.getTime()).toBe(NOW.getTime() + LOGIN_LOCK_MINUTES * 60_000);
  });

  it("preserva o primeiro horário de falha", () => {
    const first = new Date(NOW.getTime() - 5 * 60_000);
    const state = throttleAfterFailure(snapshot({ failedCount: 2, firstFailedAt: first }), NOW);

    expect(state.firstFailedAt).toEqual(first);
  });
});

describe("remainingLockMinutes", () => {
  it("é 0 quando não há bloqueio", () => {
    expect(remainingLockMinutes(snapshot(), NOW)).toBe(0);
  });

  it("arredonda para cima os minutos restantes", () => {
    const locked = snapshot({ lockedUntil: new Date(NOW.getTime() + 90_000) });
    expect(remainingLockMinutes(locked, NOW)).toBe(2);
  });

  it("é 0 quando o bloqueio já venceu", () => {
    const expired = snapshot({ lockedUntil: new Date(NOW.getTime() - 1) });
    expect(remainingLockMinutes(expired, NOW)).toBe(0);
  });
});
