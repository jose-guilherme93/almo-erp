import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import type { UserStatus } from "@/generated/prisma/enums";

import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { authConfig } from "@/server/auth/config";
import { provisionUserOnLogin } from "@/server/auth/provisioning";

const log = logger.with({ service: "auth" });

/**
 * Provider de credenciais usado **apenas** nos testes end-to-end.
 *
 * `E2E_AUTH_BYPASS` só pode ser `true` fora de produção — o `src/lib/env.ts`
 * derruba a aplicação se essa combinação acontecer. Mesmo aqui, a regra de
 * acesso continua valendo: o e-mail precisa existir e estar ACTIVE.
 */
function e2eCredentialsProvider() {
  return Credentials({
    id: "e2e",
    name: "Teste automatizado",
    credentials: {
      email: { label: "E-mail", type: "email" },
    },
    async authorize(credentials) {
      const env = getEnv();

      if (!env.E2E_AUTH_BYPASS || env.NODE_ENV === "production") {
        log.warn("tentativa de login e2e com bypass desligado");
        return null;
      }

      const email =
        typeof credentials?.["email"] === "string" ? credentials["email"].trim().toLowerCase() : "";

      if (email.length === 0) return null;

      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true, name: true, status: true },
      });

      if (!user || user.status !== "ACTIVE") return null;

      return { id: user.id, email: user.email, name: user.name };
    },
  });
}

/**
 * Instância completa do Auth.js (runtime Node — pode usar Prisma).
 *
 * Estratégia de sessão: **JWT**, sem adapter de banco. Motivo: a autorização
 * real é recalculada a cada requisição a partir do banco (`getAuthContext`),
 * então persistir sessão em tabela não acrescenta segurança — só mais uma
 * tabela para manter. O JWT carrega apenas `userId` e `status`.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
    Google({
      clientId: getEnv().AUTH_GOOGLE_ID,
      clientSecret: getEnv().AUTH_GOOGLE_SECRET,
      authorization: {
        params: {
          // Sempre deixa o usuário escolher a conta: evita entrar com a
          // conta errada quando há sessão do Google no navegador.
          prompt: "select_account",
        },
      },
      // Não confiamos no `hd` para autorizar — a checagem real é a nossa
      // política de e-mail + a tabela de usuários (docs/ARQUITETURA.md §4.4).
      allowDangerousEmailAccountLinking: false,
    }),
    // Presente sempre na lista, mas inerte: `authorize` recusa quando o
    // bypass está desligado. Assim o bundle não muda entre ambientes.
    e2eCredentialsProvider(),
  ],

  callbacks: {
    ...authConfig.callbacks,

    /**
     * Camada de decisão do login. Roda no runtime Node, logo após o Google
     * autenticar e antes de criar a sessão.
     *
     * Devolver uma string redireciona o usuário para lá — é assim que
     * levamos o motivo da negativa para `/acesso-negado`.
     */
    async signIn({ user }) {
      const email = user.email?.trim().toLowerCase();

      if (!email) {
        return "/acesso-negado?motivo=access-denied";
      }

      const result = await provisionUserOnLogin({
        email,
        name: user.name ?? null,
        avatarUrl: user.image ?? null,
      });

      if (!result.ok) {
        return `/acesso-negado?motivo=${result.reason}`;
      }

      log.info("login autorizado", { email, userId: result.userId });

      return true;
    },

    /**
     * O JWT carrega somente `userId` e `status`. Nunca colocamos permissões
     * ou lista de filiais aqui: ficariam desatualizadas e, pior, virariam
     * fonte de autorização (AGENTS.md §3.1).
     */
    async jwt({ token, user }) {
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email.trim().toLowerCase() },
          select: { id: true, status: true },
        });

        if (dbUser) {
          token["userId"] = dbUser.id;
          token["status"] = dbUser.status;
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user && typeof token["userId"] === "string") {
        session.user.id = token["userId"];
        session.user.status = token["status"] as UserStatus;
      }

      return session;
    },
  },

  events: {
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      const email = token && typeof token["email"] === "string" ? token["email"] : undefined;

      log.info("logout", { email });
    },
  },
});
