/**
 * Helpers de paginação e filtros baseados na URL (AGENTS.md §5).
 *
 * Toda listagem do sistema tem busca, filtro, ordenação e paginação em
 * `searchParams`. Isso torna qualquer tela compartilhável e faz o botão
 * "voltar" do navegador funcionar.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Lê o primeiro valor de um parâmetro (a URL pode repetir a chave). */
export function firstParam(params: RawSearchParams, key: string): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function readPage(params: RawSearchParams): number {
  const raw = Number(firstParam(params, "pagina") ?? "1");
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

export function readPageSize(params: RawSearchParams): number {
  const raw = Number(firstParam(params, "porPagina") ?? String(DEFAULT_PAGE_SIZE));

  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(raw) ? raw : DEFAULT_PAGE_SIZE;
}

export function readSearch(params: RawSearchParams): string {
  return (firstParam(params, "busca") ?? "").trim();
}

/** Monta os parâmetros de paginação para o Prisma. */
export function toPrismaPagination(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Constrói uma URL preservando os parâmetros atuais.
 *
 * `null` ou `""` remove o parâmetro; valores iguais ao padrão também são
 * removidos para a URL ficar limpa.
 */
export function buildQueryString(
  current: RawSearchParams,
  changes: Record<string, string | number | null | undefined>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(current)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, item);
    }
  }

  for (const [key, value] of Object.entries(changes)) {
    params.delete(key);

    if (value === null || value === undefined || value === "") continue;

    params.set(key, String(value));
  }

  // Não polui a URL com a página 1.
  if (params.get("pagina") === "1") params.delete("pagina");
  if (params.get("porPagina") === String(DEFAULT_PAGE_SIZE)) params.delete("porPagina");

  const query = params.toString();

  return query.length > 0 ? `?${query}` : "";
}

/** Intervalo absoluto de registros exibidos, para o rodapé da tabela. */
export function resultRange(page: number, pageSize: number, total: number): string {
  if (total === 0) return "Nenhum registro";

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return `${start}–${end} de ${total}`;
}
