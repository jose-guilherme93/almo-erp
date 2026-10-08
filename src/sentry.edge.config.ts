import * as Sentry from "@sentry/nextjs";

/**
 * Configuração do SDK na edge, onde roda o `proxy.ts`.
 *
 * A edge não tem Prisma nem Node completo, então aqui o SDK é inicializado
 * direto e o incidente **não** vai para o banco: ele só sai para o fornecedor.
 * A gravação local acontece no runtime Node, de onde vem o grosso dos erros.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  release: process.env.SENTRY_RELEASE,
});
