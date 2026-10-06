import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { NextConfig } from "next";

/** Semver do `package.json`. É o número legível da versão. */
function packageVersion(): string {
  try {
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * SHA curto do commit que gerou o build.
 *
 * Prefere o build arg `GIT_SHA` porque o `.git` **não** entra na imagem Docker
 * (ver `.dockerignore`); sem ele, tenta o repositório local e, por fim, cai em
 * `unknown`.
 */
function commitSha(): string {
  const fromEnv = process.env["GIT_SHA"]?.trim();
  if (fromEnv) return fromEnv.slice(0, 7);

  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const GIT_SHA = commitSha();
const APP_VERSION = `${packageVersion()}+${GIT_SHA}`;
const BUILD_TIME = new Date().toISOString();

/**
 * Cabeçalhos de segurança.
 *
 * CSP com `unsafe-inline` em `style-src` é necessário para o Tailwind/Next
 * injetarem estilo crítico. Já `script-src` fica restrito a `self`, que é onde
 * mora o risco real.
 */
/**
 * `script-src` em desenvolvimento.
 *
 * O runtime de desenvolvimento do React (servido por `next dev`, nos arquivos
 * `*.development.js` do RSC) usa `eval()` para reconstruir call stacks e falar
 * com o DevTools. Sem `unsafe-eval` ele reclama no console e perde a
 * reconstrução de erro. **Não** é o leitor de código de barras: o `@zxing/browser`
 * é JavaScript puro, sem WebAssembly.
 *
 * Produção nunca recebe `unsafe-eval` — o bundle de produção do React não usa
 * `eval`, e essa é a diferença entre um headerSPD de verdade e um só de fachada.
 */
const isDevelopment = process.env.NODE_ENV !== "production";

const scriptSrc = isDevelopment
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

/**
 * Origem que recebe o evento de erro do navegador.
 *
 * `connect-src 'self'` sozinho **derruba silenciosamente** o SDK: o navegador
 * bloqueia o `fetch` para o destino, o SDK não recebe confirmação, e a única
 * pista é um aviso no console de quem já está com pressa. Melhor deixar a
 * origem explícita aqui — e melhor ainda deriving do DSN, para que trocar de
 * fornecedor não exija lembrar de mexer neste arquivo.
 *
 * Sem DSN, a lista fica `'self'` e a CSP não abre nada.
 */
function ingestOrigin(): string[] {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

  if (!dsn) return [];

  try {
    return [new URL(dsn).origin];
  } catch {
    // DSN malformado é erro de configuração do ambiente, e `src/lib/env.ts` já
    // o valida. Aqui não vale derrubar o build por isso.
    return [];
  }
}

const connectSrc = ["'self'", ...ingestOrigin()].join(" ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Permissions-Policy",
    // A câmera é usada pelo leitor de código de barras; o resto fica bloqueado.
    value: "camera=(self), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://lh3.googleusercontent.com",
      "font-src 'self' data:",
      `connect-src ${connectSrc}`,
      "media-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
  // Deixa claro qual versão atendeu a requisição, sem abrir a interface.
  { key: "X-App-Version", value: APP_VERSION },
];

const nextConfig: NextConfig = {
  // Remove o cabeçalho `X-Powered-By`: não há motivo para anunciar a stack.
  poweredByHeader: false,

  // Injetado no bundle (cliente e servidor) para exibir a versão em execução.
  env: {
    NEXT_PUBLIC_APP_VERSION: APP_VERSION,
    NEXT_PUBLIC_GIT_SHA: GIT_SHA,
    NEXT_PUBLIC_BUILD_TIME: BUILD_TIME,
  },

  experimental: {
    serverActions: {
      // Anexos de imagem já chegam comprimidos; ainda assim damos folga para
      // vários arquivos em um único envio.
      bodySizeLimit: "12mb",
    },
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
