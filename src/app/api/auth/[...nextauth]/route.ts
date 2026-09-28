import { handlers } from "@/server/auth";

/**
 * Endpoints do Auth.js (`/api/auth/*`): sign-in, callback do Google, sessão e
 * sign-out. O `middleware.ts` deixa esta rota passar livremente.
 */
export const { GET, POST } = handlers;
