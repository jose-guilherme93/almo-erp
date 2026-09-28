/**
 * Constantes do produto.
 *
 * Ficam em código (e não em variável de ambiente) porque não mudam por
 * ambiente — o que muda por ambiente é lido via `@/lib/env`.
 */

export const APP_NAME = "almo-erp";

export const APP_DESCRIPTION =
  "Sistema de gestão de almoxarifado: estoque, solicitação e entrega de materiais.";

/** Fuso oficial de operação. Persistência é sempre UTC. */
export const TIME_ZONE = "America/Sao_Paulo";

export const LOCALE = "pt-BR";

/** Prefixos dos números de documento gerados por sequência. */
export const DOCUMENT_PREFIX = {
  STOCK: "MV",
  TRANSFER: "TR",
  REQUEST: "SOL",
  MAINTENANCE: "REP",
  INVENTORY: "INV",
} as const;

export const REQUEST_NUMBER_PADDING = 6;

/**
 * Códigos de setor usados pelas regras de roteamento.
 *
 * `ALMOXARIFADO`, `MANUTENCAO` e `TI` são setores que **atendem**; os demais
 * são setores que **pedem**. A TI também pode abrir pedidos (peças) em nome da
 * própria análise.
 */
export const SECTOR_CODES = {
  ALMOXARIFADO: "ALMOXARIFADO",
  MANUTENCAO: "MANUTENCAO",
  TI: "TI",
  FINANCEIRO: "FINANCEIRO",
  PEDAGOGICO: "PEDAGOGICO",
  RH: "RH",
} as const;

/** Não permite uploads maiores que isto (após compressão no navegador). */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

/** Tipos aceitos no anexo de imagem. */
export const ATTACHMENT_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

/** Maior lado da imagem depois da compressão no navegador, em pixels. */
export const ATTACHMENT_MAX_DIMENSION = 1600;

/** Cabeçalhos de CSV para exportação em Excel pt-BR. */
export const CSV_SEPARATOR = ";";
export const CSV_BOM = "\uFEFF";
