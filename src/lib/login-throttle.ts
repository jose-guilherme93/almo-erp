/**
 * Regra pura do freio de tentativas de login local (força bruta).
 *
 * Fica em `lib/` pelo mesmo motivo de `email-policy.ts`: a decisão é testável
 * sem banco. Quem lê e grava é `@/server/auth/throttle.ts`.
 */

/** Tentativas falhas antes de bloquear temporariamente. */
export const LOGIN_MAX_ATTEMPTS = 5;

/** Duração do bloqueio, em minutos. */
export const LOGIN_LOCK_MINUTES = 15;

export type ThrottleSnapshot = {
  failedCount: number;
  firstFailedAt: Date | null;
  lockedUntil: Date | null;
};

export const EMPTY_THROTTLE: ThrottleSnapshot = {
  failedCount: 0,
  firstFailedAt: null,
  lockedUntil: null,
};

/** O e-mail está bloqueado para tentar login agora? */
export function isThrottleLocked(snapshot: ThrottleSnapshot, now: Date = new Date()): boolean {
  return snapshot.lockedUntil !== null && snapshot.lockedUntil.getTime() > now.getTime();
}

/**
 * Estado depois de mais uma tentativa falha.
 *
 * Ao atingir o limite, arma o bloqueio pela janela configurada. Enquanto não
 * atinge, só incrementa o contador.
 */
export function throttleAfterFailure(
  snapshot: ThrottleSnapshot,
  now: Date = new Date(),
): ThrottleSnapshot {
  const failedCount = snapshot.failedCount + 1;
  const reachedLimit = failedCount >= LOGIN_MAX_ATTEMPTS;

  return {
    failedCount,
    firstFailedAt: snapshot.firstFailedAt ?? now,
    lockedUntil: reachedLimit ? new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60_000) : null,
  };
}

/** Minutos restantes de bloqueio (0 quando não está bloqueado). */
export function remainingLockMinutes(snapshot: ThrottleSnapshot, now: Date = new Date()): number {
  if (snapshot.lockedUntil === null || snapshot.lockedUntil.getTime() <= now.getTime()) return 0;

  return Math.ceil((snapshot.lockedUntil.getTime() - now.getTime()) / 60_000);
}
