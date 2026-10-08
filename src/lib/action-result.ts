import { isAppError } from "@/lib/errors";

/**
 * Retorno padronizado de toda Server Action (AGENTS.md §5).
 *
 * A UI nunca recebe exceção: recebe `{ ok: false, error }` com mensagem em
 * pt-BR, e `fieldErrors` quando a falha é de validação por campo.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]>; code?: string };

export function actionSuccess<T>(data: T, message?: string): ActionResult<T> {
  return message === undefined ? { ok: true, data } : { ok: true, data, message };
}

export function actionFailure(
  error: string,
  options?: { fieldErrors?: Record<string, string[]>; code?: string },
): ActionResult<never> {
  return {
    ok: false,
    error,
    ...(options?.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
    ...(options?.code ? { code: options.code } : {}),
  };
}

/**
 * Converte um erro desconhecido em `ActionResult` de falha.
 *
 * `AppError` expõe a mensagem de negócio; qualquer outro erro vira mensagem
 * genérica (o detalhe técnico vai para o log, nunca para o usuário).
 *
 * É **puro**: não registra nada. Quem relata o erro é `runAction`, em
 * `@/server/actions/run` — `lib` não conhece o funil de observabilidade, e
 * registrar aqui esconderia justamente o erro que ninguém esperava.
 */
export function actionFailureFromError(error: unknown): ActionResult<never> {
  if (isAppError(error)) {
    return actionFailure(error.userMessage, { code: error.code });
  }

  return actionFailure(
    "Ocorreu um erro inesperado. Tente novamente; se persistir, avise o administrador.",
  );
}

/**
 * Erros de controle de fluxo do Next (`redirect()`, `notFound()`, `forbidden()`)
 * não são falhas de negócio: precisam continuar subindo.
 */
export function isNextControlFlowError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest !== "string") return false;

  return (
    digest.startsWith("NEXT_REDIRECT") ||
    digest === "NEXT_NOT_FOUND" ||
    digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")
  );
}
