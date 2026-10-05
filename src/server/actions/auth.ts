"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

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
 * Login local (e-mail + senha).
 *
 * A validação de verdade é o `authorize` do provider `local`; aqui só
 * normalizamos o formulário.
 *
 * No Auth.js **v5** `signIn` **lança** `AuthError` quando o provider devolve
 * `null` — ele não redireciona com `?error=` como na v4. Deixar o erro escapar
 * derruba a tela inteira no error boundary ("Não foi possível carregar") quando
 * o usuário só digitou a senha errada. Então traduzimos o tipo de erro no mesmo
 * formato que a tela de login já sabe ler.
 */
export async function loginWithCredentialsAction(formData: FormData): Promise<void> {
  const email = formData.get("email");
  const password = formData.get("password");
  const requested = formData.get("redirectTo");

  if (typeof email !== "string" || typeof password !== "string") {
    return;
  }

  const redirectTo = typeof requested === "string" && requested.startsWith("/") ? requested : "/";

  try {
    await signIn("local", {
      email: email.trim().toLowerCase(),
      password,
      redirectTo,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      const params = new URLSearchParams({ error: error.type ?? "CredentialsSignin" });
      params.set("callbackUrl", redirectTo);

      redirect(`/login?${params.toString()}`);
    }

    throw error;
  }
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
