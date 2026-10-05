import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Hash de senha para o login local (e-mail + senha).
 *
 * Usa `scrypt` do `node:crypto` — sem dependência nova (o projeto não tem
 * bcrypt/argon2 e o `AGENTS.md` pede para não inventar biblioteca). Cada senha
 * ganha um salt aleatório; a verificação é feita em tempo constante.
 *
 * Formato armazenado: `scrypt$<salt-base64>$<hash-base64>`.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const ALGORITHM = "scrypt";
const SALT_BYTES = 16;
const KEY_BYTES = 64;

/** Tamanho mínimo aceito ao definir/trocar uma senha. */
export const PASSWORD_MIN_LENGTH = 8;

/** Teto defensivo: evita que alguém mande uma senha gigante para o scrypt. */
export const PASSWORD_MAX_LENGTH = 200;

export function isAcceptablePassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

/** Gera o hash de uma senha em texto puro. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEY_BYTES);

  return `${ALGORITHM}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/**
 * Confere a senha contra o hash armazenado.
 *
 * Nunca lança: qualquer coisa que não seja um hash válido conta como "não
 * confere" (assim um valor corrompido no banco não derruba o login).
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");

  if (parts.length !== 3 || parts[0] !== ALGORITHM) return false;

  const salt = Buffer.from(parts[1] ?? "", "base64");
  const expected = Buffer.from(parts[2] ?? "", "base64");

  if (salt.length === 0 || expected.length !== KEY_BYTES) return false;

  const derived = await scryptAsync(password, salt, KEY_BYTES);

  return timingSafeEqual(derived, expected);
}

/**
 * Queima o mesmo tempo de um `verifyPassword` real.
 *
 * Chamado quando o e-mail não existe ou não tem senha, para o tempo de resposta
 * não revelar quais contas existem.
 */
export async function burnPasswordCheckTime(password: string): Promise<void> {
  await scryptAsync(password, Buffer.alloc(SALT_BYTES), KEY_BYTES);
}
