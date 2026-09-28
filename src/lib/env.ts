import { z } from "zod";

/**
 * Validação e normalização das variáveis de ambiente.
 *
 * Falhar aqui é proposital: melhor a aplicação não subir do que subir com
 * configuração incompleta e quebrar no meio de uma operação de almoxarifado.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === "boolean" ? value : ["1", "true", "yes", "on"].includes(value.toLowerCase()),
  );

const optionalString = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .optional();

const csvDomains = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter((domain) => domain.length > 0),
  );

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  NEXT_PUBLIC_APP_NAME: z.string().trim().min(1).default("almo-erp"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),

  AUTH_SECRET: optionalString,
  AUTH_URL: optionalString,
  AUTH_TRUST_HOST: booleanish.default(true),
  AUTH_GOOGLE_ID: optionalString,
  AUTH_GOOGLE_SECRET: optionalString,
  AUTH_ALLOWED_DOMAINS: csvDomains,

  SEED_ADMIN_EMAIL: optionalString,
  SEED_ADMIN_NAME: z.string().trim().default("Administrador da Matriz"),

  SLA_APPROVAL_HOURS: z.coerce.number().int().positive().default(24),
  STOCK_BELOW_MIN_DEDUP_DAYS: z.coerce.number().int().positive().default(7),
  MATRIX_APPROVAL_THRESHOLD: z.coerce.number().nonnegative().default(1000),

  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_FROM: optionalString,
});

export type ServerEnv = z.infer<typeof serverSchema>;

function loadEnv(): ServerEnv {
  const parsed = serverSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(raiz)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${details}`);
  }

  return parsed.data;
}

/**
 * Acesso validado ao ambiente. Sempre prefira importar `env` a ler
 * `process.env` diretamente.
 *
 * Avaliado de forma preguiçosa (função memoizada) para que o `next build`
 * não exija segredos de runtime durante a coleta de páginas estáticas.
 */
let cached: ServerEnv | undefined;

export function getEnv(): ServerEnv {
  cached ??= loadEnv();
  return cached;
}

export const env = new Proxy({} as ServerEnv, {
  get: (_target, property: string) => getEnv()[property as keyof ServerEnv],
});
