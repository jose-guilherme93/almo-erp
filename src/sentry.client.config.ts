import * as Sentry from "@sentry/nextjs";

/**
 * Configuração do SDK no navegador.
 *
 * Cobre a lacuna que o servidor não alcança: erro de JavaScript do cliente, tela
 * branca e falha de hidratação. O relatório vai direto ao fornecedor — nunca ao
 * banco, porque payload de cliente é entrada não confiável.
 *
 * O DSN precisa ser lido de `process.env.NEXT_PUBLIC_*` **diretamente**: é o
 * Next que embute esse valor no bundle em tempo de build, e passar pelo
 * validador de ambiente não funciona no navegador.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  // Sem DSN o SDK fica inerte — é o comportamento esperado em dev e CI.
  enabled: Boolean(dsn),
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  release: process.env.SENTRY_RELEASE,

  /**
   * Tudo que o navegador manda sai daqui, então é a última barreira antes da
   * rede. `beforeSend` não deve lançar: um erro no filtro perderia o relatório
   * inteiro, que é justamente o que o usuário está tentando enviar.
   */
  beforeSend(event) {
    try {
      if (event.request?.query_string) event.request.query_string = undefined;

      if (event.request?.headers) {
        const forbidden = new Set(["authorization", "cookie", "x-api-key"]);

        for (const name of Object.keys(event.request.headers)) {
          if (forbidden.has(name.toLowerCase())) delete event.request.headers[name];
        }
      }

      return event;
    } catch {
      return event;
    }
  },
});
