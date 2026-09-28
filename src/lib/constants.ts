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
  INVENTORY: "INV",
} as const;

export const REQUEST_NUMBER_PADDING = 6;

/** Cabeçalhos de CSV para exportação em Excel pt-BR. */
export const CSV_SEPARATOR = ";";
export const CSV_BOM = "\uFEFF";
