import type { Metadata } from "next";
import Link from "next/link";

import { CredentialsSignInForm } from "@/components/layout/credentials-sign-in-form";
import { GoogleSignInButton } from "@/components/layout/google-sign-in-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/constants";
import { env } from "@/lib/env";
import { isGoogleLoginEnabled, isLocalLoginEnabled } from "@/server/auth/login-options";
import { loginE2EAction, loginWithGoogleAction } from "@/server/actions/auth";

/**
 * A tela de login lê os toggles em `Config` (banco), então nunca é estática:
 * se fosse pré-renderizada, congelaria o estado do banco no momento do build.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Entrar",
};

type LoginPageProps = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

/** Mensagens para os erros que o próprio Auth.js devolve na query string. */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "E-mail ou senha inválidos.",
  AccessDenied: "Seu e-mail não foi autorizado a acessar o sistema.",
  OAuthAccountNotLinked: "Este e-mail já está vinculado a outra forma de acesso.",
  OAuthCallbackError: "Não foi possível concluir o login com o Google. Tente novamente.",
  Configuration: "O login está temporariamente indisponível. Avise o administrador.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  const [localEnabled, googleEnabled] = await Promise.all([
    isLocalLoginEnabled(),
    isGoogleLoginEnabled(),
  ]);

  const errorMessage = params.error
    ? (AUTH_ERROR_MESSAGES[params.error] ?? "Não foi possível entrar. Tente novamente.")
    : null;

  // A raiz resolve a home correta pelo perfil de quem entrou.
  const redirectTo =
    params.callbackUrl && params.callbackUrl.startsWith("/") ? params.callbackUrl : "/";

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>
          <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
        </CardTitle>
        <CardDescription className="text-balance">{APP_DESCRIPTION}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {errorMessage ? (
          <p
            role="alert"
            className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
          >
            {errorMessage}
          </p>
        ) : null}

        {localEnabled ? (
          <>
            <CredentialsSignInForm redirectTo={redirectTo} />

            {googleEnabled ? (
              <div className="flex items-center gap-3">
                <span className="bg-border h-px flex-1" aria-hidden />
                <span className="text-muted-foreground text-xs">ou</span>
                <span className="bg-border h-px flex-1" aria-hidden />
              </div>
            ) : null}
          </>
        ) : null}

        <form action={loginWithGoogleAction} className="space-y-2">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <GoogleSignInButton disabled={!googleEnabled} />
          {!googleEnabled ? (
            <p className="text-muted-foreground text-center text-xs">
              Login com Google ainda não configurado.
            </p>
          ) : null}
        </form>

        <p className="text-muted-foreground text-center text-xs text-balance">
          Acesso restrito a usuários autorizados. Entre com o e-mail e a senha cadastrados pelo
          administrador.
        </p>

        <p className="text-muted-foreground text-center text-xs">
          Problemas para entrar?{" "}
          <Link href="/acesso-negado" className="underline underline-offset-4">
            Veja o que fazer
          </Link>
        </p>

        {env.E2E_AUTH_BYPASS ? (
          <form action={loginE2EAction} className="space-y-2 rounded-md border border-dashed p-3">
            <p className="text-muted-foreground text-xs font-medium">
              Ambiente de teste — entrar sem Google
            </p>
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <input
              name="email"
              type="email"
              required
              placeholder="e-mail do usuário de teste"
              aria-label="E-mail do usuário de teste"
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
            />
            <button
              type="submit"
              className="bg-secondary text-secondary-foreground h-9 w-full rounded-md text-sm"
            >
              Entrar para teste
            </button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
