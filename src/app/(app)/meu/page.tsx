import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageSession } from "@/server/auth/guards";

export const metadata: Metadata = {
  title: "Início",
};

/**
 * Home do usuário logado.
 *
 * Versão mínima da FASE 02 — comprova a sessão ponta a ponta. A versão
 * completa (minhas solicitações, entregas e notificações) é a FASE 10.
 */
export default async function MeuPage() {
  const context = await requirePageSession();

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Olá, {context.user.name.split(" ")[0]}
        </h1>
        <p className="text-muted-foreground text-sm">{context.user.email}</p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Seus acessos</CardTitle>
          <CardDescription>Unidades e perfis vinculados à sua conta.</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {context.memberships.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Você ainda não está vinculado a nenhuma unidade. Peça a um administrador para
              configurar seu acesso.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {context.memberships.map((membership) => (
                <li
                  key={`${membership.branchId}-${membership.roleSlug}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span>
                    <span className="font-medium">{membership.branchName}</span>
                    <span className="text-muted-foreground"> · {membership.branchCode}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {membership.roleName}
                    {membership.roleScope === "ALL_BRANCHES" ? " (rede)" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
