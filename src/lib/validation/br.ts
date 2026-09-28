/**
 * Validadores e normalizadores de documentos brasileiros.
 *
 * Funções puras, sem dependência externa — a validação de CNPJ é feita com o
 * cálculo dos dígitos verificadores, não com regex.
 */
import { onlyDigits } from "@/lib/format";

export const UF_LIST = [
  { code: "AC", name: "Acre" },
  { code: "AL", name: "Alagoas" },
  { code: "AP", name: "Amapá" },
  { code: "AM", name: "Amazonas" },
  { code: "BA", name: "Bahia" },
  { code: "CE", name: "Ceará" },
  { code: "DF", name: "Distrito Federal" },
  { code: "ES", name: "Espírito Santo" },
  { code: "GO", name: "Goiás" },
  { code: "MA", name: "Maranhão" },
  { code: "MT", name: "Mato Grosso" },
  { code: "MS", name: "Mato Grosso do Sul" },
  { code: "MG", name: "Minas Gerais" },
  { code: "PA", name: "Pará" },
  { code: "PB", name: "Paraíba" },
  { code: "PR", name: "Paraná" },
  { code: "PE", name: "Pernambuco" },
  { code: "PI", name: "Piauí" },
  { code: "RJ", name: "Rio de Janeiro" },
  { code: "RN", name: "Rio Grande do Norte" },
  { code: "RS", name: "Rio Grande do Sul" },
  { code: "RO", name: "Rondônia" },
  { code: "RR", name: "Roraima" },
  { code: "SC", name: "Santa Catarina" },
  { code: "SP", name: "São Paulo" },
  { code: "SE", name: "Sergipe" },
  { code: "TO", name: "Tocantins" },
] as const;

export const UF_CODES = UF_LIST.map((uf) => uf.code);

export function isUf(value: string): boolean {
  return (UF_CODES as readonly string[]).includes(value.toUpperCase());
}

function checkDigits(base: string, weights: number[]): number {
  const sum = weights.reduce(
    (total, weight, index) => total + Number(base[index] ?? 0) * weight,
    0,
  );

  const remainder = sum % 11;

  return remainder < 2 ? 0 : 11 - remainder;
}

/**
 * Valida CNPJ pelos dígitos verificadores.
 *
 * Rejeita também os números repetidos (00000000000000, 11111111111111…), que
 * passam no cálculo mas não existem.
 */
export function isValidCnpj(value: string): boolean {
  const digits = onlyDigits(value);

  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const first = checkDigits(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (first !== Number(digits[12])) return false;

  const second = checkDigits(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return second === Number(digits[13]);
}

/** Valida CPF pelos dígitos verificadores. */
export function isValidCpf(value: string): boolean {
  const digits = onlyDigits(value);

  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const first = checkDigits(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (first !== Number(digits[9])) return false;

  const second = checkDigits(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);

  return second === Number(digits[10]);
}

/** CEP: 8 dígitos. Não há dígito verificador. */
export function isValidZipCode(value: string): boolean {
  return onlyDigits(value).length === 8;
}

/** Telefone brasileiro: 10 dígitos (fixo) ou 11 (celular), com DDD válido. */
export function isValidPhone(value: string): boolean {
  const digits = onlyDigits(value);

  if (digits.length !== 10 && digits.length !== 11) return false;

  const areaCode = Number(digits.slice(0, 2));

  // DDDs válidos vão de 11 a 99.
  if (areaCode < 11 || areaCode > 99) return false;

  // Celular no Brasil começa com 9.
  if (digits.length === 11 && !digits.startsWith("9", 2)) return false;

  return true;
}

export function normalizeCnpj(value: string): string {
  return onlyDigits(value);
}

export function normalizeZipCode(value: string): string {
  return onlyDigits(value);
}

/**
 * Normaliza telefone para E.164 (`+5511999998888`).
 * Devolve `null` se não for um telefone brasileiro válido.
 */
export function normalizePhone(value: string): string | null {
  if (!isValidPhone(value)) return null;

  return `+55${onlyDigits(value)}`;
}

/** Zeros à esquerda para exibição de códigos numéricos. */
export function padCode(value: number, size = 4): string {
  return String(value).padStart(size, "0");
}
