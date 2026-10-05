import {
  EMPTY_THROTTLE,
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_ATTEMPTS,
  isThrottleLocked,
  remainingLockMinutes,
  throttleAfterFailure,
  type ThrottleSnapshot,
} from "@/lib/login-throttle";
import { prisma } from "@/lib/db";

/**
 * Freio de tentativas do login local, persistido no banco.
 *
 * A decisão (o que conta como bloqueado, quando armar) está pura em
 * `@/lib/login-throttle`; aqui só há leitura/escrita.
 */

const SELECT = {
  failedCount: true,
  firstFailedAt: true,
  lockedUntil: true,
} as const;

export async function getThrottle(email: string): Promise<ThrottleSnapshot> {
  const row = await prisma.loginThrottle.findUnique({ where: { email }, select: SELECT });

  return row ?? EMPTY_THROTTLE;
}

export async function isLoginLocked(email: string): Promise<boolean> {
  return isThrottleLocked(await getThrottle(email));
}

/** Registra uma tentativa falha; pode armar o bloqueio. */
export async function registerLoginFailure(email: string): Promise<void> {
  const next = throttleAfterFailure(await getThrottle(email));

  await prisma.loginThrottle.upsert({
    where: { email },
    create: { email, ...next },
    update: next,
  });
}

/** Zera o contador após um login bem-sucedido. */
export async function clearLoginFailures(email: string): Promise<void> {
  await prisma.loginThrottle.deleteMany({ where: { email } });
}

export { remainingLockMinutes, LOGIN_LOCK_MINUTES, LOGIN_MAX_ATTEMPTS };
