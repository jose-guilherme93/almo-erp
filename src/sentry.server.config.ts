import * as Sentry from "@sentry/nextjs";

/**
 * Configuração do SDK no servidor Node.
 *
 * O DSN é o do **Better Stack**: ele aceita o payload do SDK do Sentry, então
 * migrar para GlitchTip, Sentry ou outro qualquer é trocar esta variável — a
 * instrumentação não muda.
 *
 * O SDK v11 não tem mais a opção `sendDefaultPii`: ele deixou de anexar IP e
 * cabeçalho de usuário por conta própria. O que ainda pode vazar entra pelo
 * `beforeSend` abaixo e, antes disso, pelo `scrubIncident` do funil.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",

  // Amostragem de performance. O plano gratuito tem cota de spans; começar sem
  // trace economiza a cota inteira para o que importa: o erro.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),

  release: process.env.SENTRY_RELEASE,

  // O trace é oito ou mais de erro de produção: stack ofuscado quase não ajuda.
  includeLocalVariables: false,

  beforeSend(event) {
    if (event.request?.headers) {
      // O SDK costuma repassar cabeçalhos; a lista de proibidos vive no scrub.
      const forbidden = new Set(["authorization", "cookie", "set-cookie", "x-api-key"]);

      for (const name of Object.keys(event.request.headers)) {
        if (forbidden.has(name.toLowerCase())) delete event.request.headers[name];
      }
    }

    // Query string em tela de relatório carrega nome de pessoa e CPF.
    if (event.request?.query_string) event.request.query_string = undefined;

    return event;
  },
});
