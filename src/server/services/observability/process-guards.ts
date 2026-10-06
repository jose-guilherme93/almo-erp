import { logger } from "@/lib/logger";

const log = logger.with({ service: "process-guard" });

/**
 * Erros fatais do processo Node.
 *
 * O `onRequestError` cobre o que acontece **dentro de uma requisição**. Um
 * `unhandledRejection` de um timer, ou um `uncaughtException` de fundo, acontece
 * fora desse ciclo e morreria em silêncio — é a classe de erro que derruba o
 * container sem ninguém ver, e a que mais custa caro para descobrir depois.
 *
 * Registrar o handler não impede o processo de cair: o default do Node é
 * justamente isso, e mudar isso esconderia falha grave. O que se quer é **ver**
 * antes de morrer.
 *
 * Módulo separado porque `process.on` é API do Node: mantê-lo fora da
 * instrumentação evita que a edge o veja.
 */
export function installProcessGuards(): void {
  // Guarda para o caso de o processo já estar instrumentado (hot reload em
  // desenvolvimento recria o módulo, mas o processo é o mesmo).
  if (process.env["ALMO_PROCESS_GUARDS"] === "off") return;

  process.on("uncaughtException", (error) => {
    void reportProcessIncident("uncaughtException", error);
  });

  process.on("unhandledRejection", (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));

    void reportProcessIncident("unhandledRejection", error);
  });
}

async function reportProcessIncident(kind: string, error: Error): Promise<void> {
  try {
    log.error("erro fatal de processo", { kind, error });

    const { dispatchIncident } = await import("@/server/services/observability");

    await dispatchIncident({
      kind: "process",
      routePath: `(processo:${kind})`,
      message: error.message,
      stack: error.stack ?? null,
      context: { source: "process-guard" },
    });
  } catch {
    // O processo está morrendo; não há mais para onde reportar.
  }
}
