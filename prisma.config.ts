import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Migrations e seed usam a conexão DIRETA quando existir. No Neon, o endpoint
// pooled (PgBouncer, modo transação) não aceita DDL nem transação longa: a app
// usa o pooled (`DATABASE_URL`); o CLI usa o direto (`DIRECT_URL`).
const directUrl = process.env["DIRECT_URL"]?.trim();

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: directUrl && directUrl.length > 0 ? directUrl : env("DATABASE_URL"),
  },
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
