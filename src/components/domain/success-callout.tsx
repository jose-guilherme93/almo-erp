import { CheckCircle2 } from "lucide-react";

import { firstParam, type RawSearchParams } from "@/lib/pagination";

/**
 * Aviso de sucesso pós-redirect.
 *
 * As Server Actions redirecionam com um parâmetro (`?criado=1`) em vez de
 * devolver estado para o cliente: é mais confiável e sobrevive a um F5.
 */
export function SuccessCallout({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
    >
      <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

/**
 * Devolve a mensagem do primeiro parâmetro presente na URL.
 *
 * Ex.: `successMessageFrom(params, { criado: "Usuário criado." })`
 */
export function successMessageFrom(
  params: RawSearchParams,
  messages: Record<string, string>,
): string | null {
  for (const [key, message] of Object.entries(messages)) {
    if (firstParam(params, key) !== undefined) return message;
  }

  return null;
}
