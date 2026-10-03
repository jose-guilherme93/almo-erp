import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import type { UserStatus } from "@/generated/prisma/enums";

import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { burnPasswordCheckTime, verifyPassword } from "@/lib/password";
import { authConfig } from "@/server/auth/config";
import { isLocalLoginEnabled } from "@/server/auth/login-options";
import { provisionUserOnLogin, resolveLocalLogin } from "@/server/auth/provisioning";
import { clearLoginFailures, isLoginLocked, registerLoginFailure } from "@/server/auth/throttle";

const log = logger.with({ service: "auth" });

/** Id do provider de login local (e-mail + senha). */
const LOCAL_PROVIDER_ID = "local";

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
 * Provider do login local (e-mail + senha).
 *
 * Entra quem tem senha cadastrada e status `ACTIVE`. Diferente do Google,
 * **não** aplica a regra de domínio corporativo: a conta é criada por um
 * administrador, em qualquer domínio. O recurso é ligado/desligado em
 * `/admin/configuracoes` (`auth.localLogin.enabled`).
 */
function localCredentialsProvider() {
  return Credentials({
    id: LOCAL_PROVIDER_ID,
    name: "E-mail e senha",
    credentials: {
      email: { label: "E-mail", type: "email" },
      password: { label: "Senha", type: "password" },
    },
    async authorize(credentials) {
      if (!(await isLocalLoginEnabled())) {
        log.warn("tentativa de login local com o recurso desligado");
        return null;
      }

      const email =
        typeof credentials?.["email"] === "string" ? credentials["email"].trim().toLowerCase() : "";
      const password = typeof credentials?.["password"] === "string" ? credentials["password"] : "";

      if (email.length === 0 || password.length === 0) return null;

      if (await isLoginLocked(email)) {
        log.warn("login local bloqueado por tentativas", { email });
        return null;
      }

      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          active: true,
          passwordHash: true,
        },
      });

      // Sempre gasta o tempo do scrypt — mesmo sem conta ou sem senha — para o
      // tempo de resposta não revelar quais e-mails existem.
      let passwordOk = false;

      if (user?.passwordHash) {
        passwordOk = await verifyPassword(password, user.passwordHash);
      } else {
        await burnPasswordCheckTime(password);
      }

      if (!user || !user.active || user.status !== "ACTIVE" || !passwordOk) {
        await registerLoginFailure(email);
        log.warn("login local recusado", { email });
        return null;
      }

      await clearLoginFailures(email);

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
    // Também sempre presente: o `authorize` consulta o toggle no banco.
    localCredentialsProvider(),
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
    async signIn({ user, account }) {
      const email = user.email?.trim().toLowerCase();

      if (!email) {
        return "/acesso-negado?motivo=access-denied";
      }

      // Login local: a senha já foi conferida no `authorize`. Aqui só
      // reafirmamos o estado da conta — sem a regra de domínio corporativo.
      if (account?.provider === LOCAL_PROVIDER_ID) {
        const local = await resolveLocalLogin(email);

        if (!local.ok) {
          return `/acesso-negado?motivo=${local.reason}`;
        }

        log.info("login local autorizado", { email, userId: local.userId });

        return true;
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
