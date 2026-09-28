"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[auth] erro na tela de autenticação:", error);
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
