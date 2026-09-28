import { redirect } from "next/navigation";

import { getAuthContext } from "@/server/auth/context";

/**
 * Entrada do sistema.
 *
 * Com sessão válida vai para a home do usuário; sem sessão, para o login.
 * O roteamento por perfil (matriz → dashboard, admin de filial → dashboard da
 * unidade) é implementado na FASE 10.
 */
export default async function HomePage() {
  const context = await getAuthContext();

  redirect(context ? "/meu" : "/login");
}
