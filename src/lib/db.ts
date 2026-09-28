/**
 * Cliente Prisma único da aplicação.
 *
 * Prisma 7 exige um driver adapter — usamos o `@prisma/adapter-pg` sobre o
 * `pg` (node-postgres).
 *
 * O cache em `globalThis` evita abrir um pool novo a cada hot reload em
 * desenvolvimento.
 */
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

const PRISMA_CACHE_KEY = "almoErpPrismaClient";

type PrismaGlobal = typeof globalThis & {
  [PRISMA_CACHE_KEY]?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: getEnv().DATABASE_URL });

  return new PrismaClient({
    adapter,
    log:
      getEnv().NODE_ENV === "development"
        ? [
            { emit: "stdout", level: "warn" },
            { emit: "stdout", level: "error" },
          ]
        : [{ emit: "stdout", level: "error" }],
  });
}

const globalForPrisma = globalThis as PrismaGlobal;

export const prisma: PrismaClient = globalForPrisma[PRISMA_CACHE_KEY] ?? createPrismaClient();

if (getEnv().NODE_ENV !== "production") {
  globalForPrisma[PRISMA_CACHE_KEY] = prisma;
}
