import Link from "next/link";

import { Button } from "@/components/ui/button";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/constants";

/**
 * Página raiz.
 *
 * Placeholder da FASE 00: na FASE 02 vira um `redirect()` para a home
 * correta conforme o perfil do usuário autenticado.
 */
export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="text-muted-foreground max-w-md text-balance">{APP_DESCRIPTION}</p>
      </div>

      <p className="text-muted-foreground max-w-md text-sm">
        Projeto em construção — FASE 00 (fundamentos) concluída. O acesso será liberado após a
        implementação da autenticação.
      </p>

      <Button asChild>
        <Link href="/login">Entrar</Link>
      </Button>
    </main>
  );
}
