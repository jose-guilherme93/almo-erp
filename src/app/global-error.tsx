"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

import { Button } from "@/components/ui/button";
import "@/app/globals.css";

/**
 * Última tela antes da tela branca.
 *
 * Cobre a classe de erro que o servidor não alcança: exceção de render no
 * cliente, falha de hidratação, e o `error.tsx` da própria rota que também não
 * conseguiu renderizar. É a tela que o usuário vê quando **nada** do produto
 * funciona — e por isso é a que mais precisa dizer o que aconteceu.
 *
 * ## Por que `error.tsx` não resolve
 *
 * O Next chama `onRequestError` para erro de render **no servidor**, route e
 * action. Erro no cliente não passa por esse gancho: ele morre na tela. Por isso
 * o relato sai daqui, explicitamente, no momento em que a tela de erro é
 * montada — que é quando o erro está disponível.
 *
 * ## Por que o CSS é importado aqui
 *
 * Esta tela substitui o layout raiz, e é ele quem importava `globals.css`.
 * Sem o import, o navegador receberia HTML sem estilo — uma tela de erro
 * quebrada em cima de um erro. Por isso o arquivo é importado de novo.
 *
 * ## Por que não escreve no banco
 *
 * O que vem do cliente é entrada não confiável. Gravar isso no `ErrorLog`
 * abriria a tabela de erro para quem quiser injetar erro, e a tela de
 * observabilidade viraria canal de entrada de dados falsos. O relatório vai
 * para o destino externo, que tem cota, filtro e o próprio `beforeSend`.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // O agrupamento de repetição fica com o destino externo, que agrupa por
    // fingerprint (stack + versão). Clicar em "tentar de novo" não precisa gerar
    // um relatório novo: o mesmo defeito tem que continuar sendo **um** erro,
    // senão o contador que diga o quão grave é algo passa a mentir.
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="bg-background text-foreground flex min-h-full items-center justify-center">
        <main className="w-full max-w-md space-y-6 p-8 text-center">
          <div className="space-y-2">
            <h1 className="text-lg font-semibold">Algo quebrou nesta tela</h1>
            <p className="text-muted-foreground text-sm">
              O erro foi registrado e já está com o administrador. Você pode tentar de novo — se
              persistir, o problema não está no que você fez.
            </p>
          </div>

          {error.digest ? (
            <p className="text-muted-foreground font-mono text-xs">Referência: {error.digest}</p>
          ) : null}

          <Button type="button" onClick={reset}>
            Tentar de novo
          </Button>
        </main>
      </body>
    </html>
  );
}
