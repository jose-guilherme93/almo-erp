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
