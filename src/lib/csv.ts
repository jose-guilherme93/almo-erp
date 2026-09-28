import { CSV_BOM, CSV_SEPARATOR } from "@/lib/constants";

/**
 * Geração de CSV para Excel em português.
 *
 * Três detalhes que fazem a diferença na prática:
 *   - BOM UTF-8: sem ele o Excel abre "ç" e "ã" como lixo
 *   - separador `;`: o Excel pt-BR espera ponto e vírgula, não vírgula
 *   - decimal com vírgula: idem
 */

export type CsvValue =
  | string
  | number
  | boolean
  | null
  | undefined
  // Decimal do Prisma, Date e afins — convertidos via `toString()`.
  | { toString(): string };

/** Escapa um valor: aspas duplicadas e campos que precisam de quote. */
export function escapeCsvValue(value: CsvValue): string {
  if (value === null || value === undefined) return "";

  // `Decimal` do Prisma e Date caem aqui: convertemos para texto legível.
  const text = typeof value === "object" ? String(value) : String(value);

  if (
    text.includes(CSV_SEPARATOR) ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r")
  ) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

/** Converte um número para o formato decimal brasileiro (`1234.5` → `1234,5`). */
export function toCsvNumber(value: string | number): string {
  const text = String(value);

  return text.includes(".") ? text.replace(".", ",") : text;
}

export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<readonly CsvValue[]>,
): string {
  const lines = [
    headers.map(escapeCsvValue).join(CSV_SEPARATOR),
    ...rows.map((row) => row.map(escapeCsvValue).join(CSV_SEPARATOR)),
  ];

  return `${CSV_BOM}${lines.join("\r\n")}`;
}

/**
 * Nome de arquivo previsível: relatório, período e filial.
 * Evita o clássico "export (3).csv" na pasta do usuário.
 */
export function csvFileName(parts: {
  report: string;
  from?: string | null;
  to?: string | null;
  suffix?: string | null;
}): string {
  const segments = [parts.report, parts.from, parts.to, parts.suffix].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );

  const slug = segments
    .join("-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${slug || "relatorio"}.csv`;
}

/** Período padrão dos relatórios: últimos 30 dias. */
export function defaultPeriod(days = 30): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

/** Presets de período oferecidos na interface. */
export const PERIOD_PRESETS = [
  { id: "30d", label: "Últimos 30 dias", days: 30 },
  { id: "90d", label: "Últimos 90 dias", days: 90 },
  { id: "mes", label: "Mês atual", days: 0 },
  { id: "mes-anterior", label: "Mês anterior", days: 0 },
  { id: "ano", label: "Ano atual", days: 0 },
] as const;

export type PeriodPresetId = (typeof PERIOD_PRESETS)[number]["id"];

/** Resolve um preset em `from`/`to` no formato `YYYY-MM-DD`. */
export function resolvePreset(
  preset: PeriodPresetId,
  reference = new Date(),
): {
  from: string;
  to: string;
} {
  const pad = (date: Date) => date.toISOString().slice(0, 10);

  switch (preset) {
    case "30d":
      return defaultPeriod(30);
    case "90d":
      return defaultPeriod(90);
    case "mes": {
      const from = new Date(reference.getFullYear(), reference.getMonth(), 1);
      return { from: pad(from), to: pad(reference) };
    }
    case "mes-anterior": {
      const from = new Date(reference.getFullYear(), reference.getMonth() - 1, 1);
      const to = new Date(reference.getFullYear(), reference.getMonth(), 0);
      return { from: pad(from), to: pad(to) };
    }
    case "ano": {
      const from = new Date(reference.getFullYear(), 0, 1);
      return { from: pad(from), to: pad(reference) };
    }
  }
}
