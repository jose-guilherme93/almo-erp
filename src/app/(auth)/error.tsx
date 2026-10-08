"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Estado de erro da tela de autenticação.
 *
 * Vale mais o relato aqui do que nas demais: quem está fora do sistema não tem
 * como ser notificado por nada dentro dele, e uma falha no login é exatamente a
 * que tranca todo mundo do lado de fora. Se a tela de acesso cai, o ERP inteiro
 * cai na perception de quem usa.
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Não foi possível carregar</CardTitle>
        <CardDescription>Ocorreu um problema ao abrir esta tela. Tente novamente.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={reset} variant="outline" className="w-full">
          Tentar novamente
        </Button>
      </CardContent>
    </Card>
  );
}
