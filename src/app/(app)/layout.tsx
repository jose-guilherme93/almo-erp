import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { APP_NAME } from "@/lib/constants";
import { logoutAction } from "@/server/actions/auth";
import { requirePageSession } from "@/server/auth/guards";

/**
 * Shell da área autenticada.
 *
 * O guard vive aqui: toda rota dentro de `(app)` passa por ele. Um usuário
 * suspenso ou removido perde acesso na requisição seguinte, mesmo com JWT
 * ainda válido (o contexto é relido do banco).
 *
 * A navegação lateral completa por perfil chega na FASE 10.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const context = await requirePageSession();

  const activeMembership = context.activeBranchId
    ? context.getMembership(context.activeBranchId)
    : undefined;

  return (
    <div className="flex min-h-svh flex-col">
      <header className="bg-background sticky top-0 z-30 border-b">
        <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
          <Link href="/meu" className="font-semibold tracking-tight">
            {APP_NAME}
          </Link>

          {activeMembership ? (
            <span className="text-muted-foreground hidden items-center gap-2 text-sm sm:flex">
              <Badge variant={activeMembership.branchType === "MATRIX" ? "default" : "secondary"}>
                {activeMembership.branchCode}
              </Badge>
              {activeMembership.branchName}
            </span>
          ) : null}

          <div className="ml-auto flex items-center gap-3">
            <span className="text-muted-foreground hidden text-sm sm:inline">
              {context.user.name}
            </span>

            <form action={logoutAction}>
              <Button type="submit" variant="ghost" size="sm">
                Sair
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
