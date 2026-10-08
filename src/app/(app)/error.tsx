"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

import { Button } from "@/components/ui/button";

/**
 * Estado de erro das rotas autenticadas.
 *
 * Mostra apenas uma mensagem genérica: detalhe técnico vai para o log, nunca
 * para a tela (AGENTS.md §6 e FASE 13).
 *
 * O relato sai daqui e não do servidor porque erro de render no cliente não
 * passa por `onRequestError`. Sem esta linha, o erro existiria no `console` do
 * navegador — que ninguém vê em produção — e o `ErrorLog` nunca souberia dele.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // `captureGlobalException` e não `captureException`: é o formato que o
    // destino externo agrupa por sessão, então clicar em "tentar de novo"
    // repetidas vezes não multiplica o mesmo incidente.
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Algo deu errado</h2>
        <p className="text-muted-foreground text-sm">
          Não foi possível carregar esta tela. Tente novamente.
        </p>
        {error.digest ? (
          <p className="text-muted-foreground font-mono text-xs">Referência: {error.digest}</p>
        ) : null}
      </div>

      <Button onClick={reset} variant="outline">
        Tentar novamente
      </Button>
    </div>
  );
}
