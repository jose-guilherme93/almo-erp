"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginWithCredentialsAction } from "@/server/actions/auth";

/**
 * Formulário de login local (e-mail + senha).
 *
 * Cliente só pelo estado de `pending` do `useFormStatus`: o scrypt leva alguns
 * milissegundos e o botão precisa sinalizar que algo está acontecendo.
 */

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="w-full" size="lg">
      {pending ? "Entrando…" : "Entrar"}
    </Button>
  );
}

export function CredentialsSignInForm({ redirectTo }: { redirectTo: string }) {
  return (
    <form action={loginWithCredentialsAction} className="space-y-3">
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <div className="space-y-1.5">
        <Label htmlFor="login-email">E-mail</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          required
          autoComplete="username"
          placeholder="voce@empresa.com.br"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="login-password">Senha</Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>

      <SubmitButton />
    </form>
  );
}
