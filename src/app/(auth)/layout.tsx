import type { ReactNode } from "react";

/**
 * Layout das telas públicas de autenticação (`/login`, `/acesso-negado`).
 *
 * Fica fora do shell autenticado de propósito: nenhum menu, nenhum dado de
 * filial — apenas a identidade do produto.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-muted/30 flex min-h-svh flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
