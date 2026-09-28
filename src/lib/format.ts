/**
 * Formatação para apresentação em pt-BR.
 *
 * Regra do projeto (AGENTS.md §3.5): dinheiro e quantidade são `Decimal` no
 * banco e viram string aqui — nunca passe `number` para cá em cálculo
 * monetário. Aceitamos `Decimal | string | number` apenas para conveniência
 * de leitura de valores já calculados.
 */

export const LOCALE = "pt-BR";
export const TIME_ZONE = "America/Sao_Paulo";
export const CURRENCY = "BRL";

export type Numeric = string | number | { toString(): string };

function toPlainString(value: Numeric): string {
  return typeof value === "object" ? value.toString() : String(value);
}

/** `"1234.5"` → `"1.234,50"` */
export function formatCurrency(value: Numeric): string {
  const parsed = Number(toPlainString(value));

  if (!Number.isFinite(parsed)) return "—";

  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: CURRENCY,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parsed);
}

/** `"1234.5"` → `"1.234,5"` (remove zeros à direita) */
export function formatQuantity(value: Numeric): string {
  const raw = toPlainString(value);
  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) return "—";

  const decimals = raw.includes(".") ? (raw.split(".")[1]?.length ?? 0) : 0;

  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(decimals, 4),
  }).format(parsed);
}

/** Quantidade com unidade: `formatQuantityWithUnit("12", "CX")` → `"12 CX"` */
export function formatQuantityWithUnit(value: Numeric, unitCode: string): string {
  return `${formatQuantity(value)} ${unitCode}`;
}

function toDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `28/09/2026` */
export function formatDate(value: Date | string | number): string {
  const date = toDate(value);
  if (!date) return "—";

  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TIME_ZONE,
  }).format(date);
}

/** `28/09/2026 14:30` */
export function formatDateTime(value: Date | string | number): string {
  const date = toDate(value);
  if (!date) return "—";

  // O Intl pt-BR separa data e hora com ", ". Montamos por partes para ter
  // um separador único e previsível em toda a interface.
  const parts = new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  }).formatToParts(date);

  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? "";

  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}

/** `28/09/2026 às 14:30` */
export function formatLongDateTime(value: Date | string | number): string {
  const date = toDate(value);
  if (!date) return "—";

  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: TIME_ZONE,
  }).format(date);
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 1000 * 60 * 60 * 24 * 365],
  ["month", 1000 * 60 * 60 * 24 * 30],
  ["day", 1000 * 60 * 60 * 24],
  ["hour", 1000 * 60 * 60],
  ["minute", 1000 * 60],
  ["second", 1000],
];

/** `há 3 horas`, `em 2 dias` */
export function formatRelative(
  value: Date | string | number,
  reference: Date = new Date(),
): string {
  const date = toDate(value);
  if (!date) return "—";

  const diffMs = date.getTime() - reference.getTime();
  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diffMs) >= ms || unit === "second") {
      return formatter.format(Math.round(diffMs / ms), unit);
    }
  }

  return "agora";
}

/** Duração em horas → `"2 d 4 h"` ou `"5 h 30 min"`. Usado em SLA. */
export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return "—";

  const wholeHours = Math.floor(hours);
  const days = Math.floor(wholeHours / 24);
  const remainingHours = wholeHours % 24;

  if (days > 0) return `${days} d ${remainingHours} h`;

  const minutes = Math.round((hours - wholeHours) * 60);
  if (wholeHours === 0) return `${minutes} min`;

  return minutes > 0 ? `${wholeHours} h ${minutes} min` : `${wholeHours} h`;
}

/** Máscara de CNPJ: `"12345678000199"` → `"12.345.678/0001-99"` */
export function formatCnpj(value: string): string {
  const digits = onlyDigits(value);
  if (digits.length !== 14) return value;

  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/** Máscara de CEP: `"01310100"` → `"01310-100"` */
export function formatZipCode(value: string): string {
  const digits = onlyDigits(value);
  if (digits.length !== 8) return value;

  return digits.replace(/^(\d{5})(\d{3})$/, "$1-$2");
}

/** Máscara de telefone: fixo e celular (10 ou 11 dígitos). */
export function formatPhone(value: string): string {
  const digits = onlyDigits(value);

  if (digits.length === 11) {
    return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  }

  if (digits.length === 10) {
    return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  }

  return value;
}

export function onlyDigits(value: string): string {
  return value.replace(/\D+/g, "");
}
