import NextAuth from "next-auth";

import { authConfig } from "@/server/auth/config";

/**
 * Proxy de borda (convenção `proxy.ts` do Next 16; substitui `middleware.ts`).
 *
 * Aqui mora apenas o **gate grosso**: ele responde a uma única pergunta —
 * "existe sessão?". Se não existir, redireciona para `/login`. Nada de papel,
 * nada de filial, nada de banco.
 *
 * O motivo está em `AGENTS.md §3.1`: houve advisory de segurança do Next.js
 * (jul/2026) sobre bypass de middleware. Autorização que depende da borda é
 * autorização que pode ser contornada. A checagem real acontece no servidor,
 * a cada requisição, em `getAuthContext()` + guards.
 */
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  matcher: [
    /*
     * Roda em tudo, exceto:
     *  - /api/auth/*           (endpoints do próprio Auth.js)
     *  - /login, /acesso-negado
     *  - /manifest.webmanifest (o navegador busca sem cookie: precisa passar)
     *  - arquivos estáticos do Next e assets públicos
     */
    "/((?!api/auth|_next/static|_next/image|login|acesso-negado|manifest\\.webmanifest|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|webmanifest|woff2?)$).*)",
  ],
};
