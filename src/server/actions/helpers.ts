import { headers } from "next/headers";
import type { z } from "zod";

import { actionFailure, type ActionResult } from "@/lib/action-result";

/**
 * Utilitários compartilhados pelas Server Actions.
 *
 * `runAction` (em `@/lib/action-result`) cuida de capturar erros de domínio.
 * Aqui ficam a leitura de formulário e os metadados de auditoria.
 */

export type FormValues = Record<string, string | string[] | undefined>;

export function formDataToValues(formData: FormData): FormValues {
  const values: FormValues = {};

  for (const [key, value] of formData.entries()) {
    // Uploads (File) são ignorados: nenhum formulário deste projeto envia
    // arquivo pelo FormData nativo.
    if (typeof value !== "string") continue;

    const current = values[key];

    if (current === undefined) {
      values[key] = value;
    } else if (Array.isArray(current)) {
      current.push(value);
    } else {
      values[key] = [current, value];
    }
  }

  return values;
}

/** Lê um campo de texto, devolvendo `undefined` quando vazio. */
export function readText(values: FormValues, key: string): string | undefined {
  const raw = values[key];
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (value === undefined) return undefined;

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

/** Lê um campo booleano de checkbox (`"on"` quando marcado). */
export function readBoolean(values: FormValues, key: string): boolean {
  const raw = values[key];
  const value = Array.isArray(raw) ? raw[0] : raw;

  return value === "on" || value === "true" || value === "1";
}

/** Lê um campo que pode se repetir (ex.: múltiplas filiais). */
export function readList(values: FormValues, key: string): string[] {
  const raw = values[key];

  if (raw === undefined) return [];

  return (Array.isArray(raw) ? raw : [raw]).map((item) => item.trim()).filter(Boolean);
}

export function readNumber(values: FormValues, key: string): number | undefined {
  const value = readText(values, key);
  if (value === undefined) return undefined;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Converte os erros do Zod em `fieldErrors` para o formulário.
 * A chave usa o caminho do campo (`branchIds.0`), que a UI mapeia.
 */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }

  return fieldErrors;
}

/** Falha de validação padronizada. */
export function validationFailure(error: z.ZodError): ActionResult<never> {
  const fieldErrors = toFieldErrors(error);
  const firstMessage = error.issues[0]?.message ?? "Dados inválidos.";

  return actionFailure(firstMessage, { fieldErrors, code: "VALIDATION" });
}

/** IP e user-agent de quem chamou a action, para a trilha de auditoria. */
export async function requestMetadata(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const headerList = await headers();
    const forwarded = headerList.get("x-forwarded-for");

    return {
      ip: forwarded ? (forwarded.split(",")[0]?.trim() ?? null) : headerList.get("x-real-ip"),
      userAgent: headerList.get("user-agent"),
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}
