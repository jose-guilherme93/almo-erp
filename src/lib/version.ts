/**
 * Identificação da versão em execução.
 *
 * Os valores são injetados no build por `next.config.ts`: semver do
 * `package.json` + SHA curto do commit + data do build. Em produção o `GIT_SHA`
 * chega como *build arg* do Docker, porque o `.git` não entra na imagem
 * (`.dockerignore`).
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0+dev";
export const GIT_SHA = process.env.NEXT_PUBLIC_GIT_SHA ?? "unknown";
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? null;
