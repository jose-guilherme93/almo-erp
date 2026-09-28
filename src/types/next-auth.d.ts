import type { DefaultSession } from "next-auth";
import type { UserStatus } from "@/generated/prisma/enums";

/**
 * Estende os tipos de sessão do Auth.js.
 *
 * O JWT/sessão carregam apenas `id` e `status` — o resto do contexto
 * (permissões, filiais) é sempre relido do banco por `getAuthContext`.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      status: UserStatus;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    status?: UserStatus;
  }
}
