import type { NextAuthConfig } from "next-auth";

/**
 * Configuração de autenticação segura para o Edge Runtime.
 *
 * Este arquivo é importado pelo `middleware.ts`, portanto **não pode** tocar
 * Prisma nem qualquer coisa de Node. Ele contém apenas:
 *   - páginas de login/erro
 *   - estratégia de sessão
 *   - o callback `authorized` (gate grosso)
 *
 * Toda a regra de negócio de acesso vive em `./provisioning.ts` e roda no
 * runtime Node, dentro do callback `signIn` de `./index.ts`.
 *
 * IMPORTANTE (AGENTS.md §3.1): o middleware é conveniência de UX, nunca a
 * barreira de autorização. A checagem real de status/permissão acontece no
 * servidor, a cada requisição, lendo o banco.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
    error: "/acesso-negado",
  },

  session: {
    strategy: "jwt",
    // Revogação efetiva acontece pela releitura do banco a cada request;
    // o maxAge limita a janela de um JWT já emitido.
    maxAge: 60 * 60 * 12,
  },

  providers: [],

  callbacks: {
    /**
     * Gate grosso: "existe sessão?". Nenhuma decisão de papel/filial aqui.
     * Sem sessão, o Auth.js redireciona para `pages.signIn`.
     */
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
  },

  trustHost: true,
} satisfies NextAuthConfig;
