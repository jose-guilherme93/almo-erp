import { env } from "@/lib/env";
import { isConfigFlagEnabled } from "@/server/services/config";

/**
 * Quais formas de login estão ligadas.
 *
 * Fonte da verdade é o banco (`Config`), ajustável pelo SUPER_ADMIN em
 * `/admin/configuracoes`. O default do Google é derivado da credencial: sem
 * `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` o botão não faz sentido e fica desligado.
 */

export const LOCAL_LOGIN_CONFIG_KEY = "auth.localLogin.enabled";
export const GOOGLE_LOGIN_CONFIG_KEY = "auth.google.enabled";

export function hasGoogleCredentials(): boolean {
  return Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);
}

export async function isLocalLoginEnabled(): Promise<boolean> {
  return isConfigFlagEnabled(LOCAL_LOGIN_CONFIG_KEY, true);
}

export async function isGoogleLoginEnabled(): Promise<boolean> {
  return isConfigFlagEnabled(GOOGLE_LOGIN_CONFIG_KEY, hasGoogleCredentials());
}
