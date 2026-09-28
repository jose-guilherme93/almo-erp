import { redirect } from "next/navigation";

import { getAuthContext } from "@/server/auth/context";
import { resolveHomeRoute } from "@/server/auth/home-route";

/**
 * Entrada do sistema.
 *
 * Com sessão válida, cada perfil vai para a sua home: matriz → dashboard da
 * rede; quem aprova → dashboard da unidade; demais → minhas solicitações.
 */
export default async function HomePage() {
  const context = await getAuthContext();

  redirect(context ? resolveHomeRoute(context) : "/login");
}
