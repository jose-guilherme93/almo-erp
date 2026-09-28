import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageSession } from "@/server/auth/guards";

export const metadata: Metadata = {
  title: "Sem permissão",
};

/**
 * 403 amigável.
 *
 * Nunca redirecionamos silenciosamente para outra tela quando o usuário não
 * tem permissão: isso confunde (o usuário acha que a tela não existe) e
 * esconde o problema de configuração de papel.
 */
export default async function ForbiddenPage() {
  const context = await requirePageSession();

  const roles = [...new Set(context.memberships.map((membership) => membership.roleName))];

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>
            <h1 className="text-lg font-semibold tracking-tight">
              Você não tem permissão para acessar esta área
            </h1>
          </CardTitle>
          <CardDescription className="text-balance">
            Seu perfil atual não inclui esta funcionalidade.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {roles.length > 0 ? (
            <p className="text-muted-foreground text-sm">
              Seus perfis: <span className="text-foreground">{roles.join(", ")}</span>
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">
              Você ainda não está vinculado a nenhuma unidade. Peça a um administrador para
              configurar seu acesso.
            </p>
          )}

          <p className="text-muted-foreground text-sm">
            Precisa deste acesso? Solicite ao administrador da sua unidade.
          </p>

          <Button asChild variant="outline">
            <Link href="/meu">Voltar ao início</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
