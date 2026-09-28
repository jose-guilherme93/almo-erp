"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

/**
 * Botão de login com Google.
 *
 * Cliente porque precisa do estado de `pending` do `useFormStatus` — durante o
 * redirect do OAuth a página fica vários segundos sem resposta e o usuário
 * precisa saber que algo está acontecendo.
 */
export function GoogleSignInButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="w-full" size="lg">
      {pending ? "Redirecionando para o Google…" : "Entrar com Google"}
    </Button>
  );
}
