"use server";

import { signIn, signOut } from "@/server/auth";

/**
 * Ações de autenticação.
 *
 * Não passam por `runAction`: `signIn`/`signOut` sinalizam o redirect
 * lançando um erro de controle de fluxo do Next, que precisa escapar.
 */

export async function loginWithGoogleAction(formData: FormData): Promise<void> {
  const requested = formData.get("redirectTo");
  const redirectTo =
    typeof requested === "string" && requested.startsWith("/") ? requested : "/meu";

  await signIn("google", { redirectTo });
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

/**
 * Login por credenciais para os testes end-to-end.
 *
 * A página de login só renderiza o formulário que chama esta ação quando
 * `E2E_AUTH_BYPASS` está ligado — e o `authorize` do provider recusa em
 * produção. Duas travas independentes.
 */
export async function loginE2EAction(formData: FormData): Promise<void> {
  const email = formData.get("email");
  const requested = formData.get("redirectTo");

  if (typeof email !== "string" || email.trim().length === 0) {
    return;
  }

  const redirectTo = typeof requested === "string" && requested.startsWith("/") ? requested : "/";

  await signIn("e2e", { email: email.trim().toLowerCase(), redirectTo });
}
