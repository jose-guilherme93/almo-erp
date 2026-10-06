import type { Instrumentation } from "next";

/**
 * Captura de erro de servidor.
 *
 * Sem isto, um erro de render, de Route Handler ou de Server Action só existe
 * como linha no stdout do container: ninguém lê aquilo, e o usuário vê apenas
 * "Referência: abc123" sem que ninguém consiga saber o que aconteceu. Aqui o
 * erro vira consultável em `/admin/erros`, e o `digest` que o usuário relata
 * acha exatamente a linha.
 *
 * Este arquivo roda em **dois runtimes**. O `proxy.ts` roda na edge, e a edge
 * não tem Prisma — por isso o serviço entra por `import()` dinâmico, só no
 * `nodejs`. Na edge o comportamento é só o log, que é o que já existe hoje.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // Nunca lançar. Se esta função falhar, o Next registra
  // "Error in instrumentation.onRequestError" e o erro original se perde.
  try {
    const digest = digestOf(error);
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? null) : null;

    if (process.env.NEXT_RUNTIME !== "nodejs") {
      console.error("[erro:edge]", request.path, context.routeType, digest, message);
      return;
    }

    // Import dinâmico: puxar o Prisma no topo do arquivo quebraria a edge.
    const { recordServerError } = await import("@/server/services/error-log");

    const result = await recordServerError({
      message,
      digest,
      stack,
      routePath: request.path,
      routeType: context.routeType,
      method: request.method,
    });

    // Só a primeira ocorrência é novel: incrementar em silêncio é o que impede
    // o sino de virar fonte de ruído quando o erro se repete.
    if (result.outcome === "created") {
      const { reportNewError } = await import("@/server/services/error-log-alert");
      await reportNewError(result.id);
    }
  } catch {
    // Última linha: se nem o log funcionou, não há mais para onde olhar.
  }
};

/** O Next pode reusar o mesmo digest para erros diferentes; ainda é a melhor chave. */
function digestOf(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "digest" in error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string") return digest;
  }

  return null;
}
