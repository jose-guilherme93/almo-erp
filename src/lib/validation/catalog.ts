import { z } from "zod";

import { onlyDigits } from "@/lib/format";

/** Validações do catálogo de materiais (categorias, unidades e itens). */

const codeField = (label: string, max = 30) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .min(1, `${label} é obrigatório.`)
    .max(max, `${label} é muito longo.`)
    .regex(/^[A-Z0-9][A-Z0-9.-]*$/, `${label} deve usar apenas letras, números, ponto e hífen.`);

const nameField = (label: string, max = 120) =>
  z
    .string()
    .trim()
    .min(2, `${label} precisa ter ao menos 2 caracteres.`)
    .max(max, `${label} é muito longo.`);

const optionalText = (max = 300) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === "" ? undefined : value));

/**
 * Valida código de barras GTIN (EAN-8, UPC-12, EAN-13 e GTIN-14).
 *
 * O dígito verificador é conferido: cadastrar um código errado faria o
 * leitor nunca encontrar o material no balcão.
 */
export function isValidBarcode(value: string): boolean {
  const digits = onlyDigits(value);

  if (![8, 12, 13, 14].includes(digits.length)) return false;

  const numbers = digits.split("").map(Number);
  const check = numbers.pop();

  if (check === undefined) return false;

  const sum = numbers
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);

  return (10 - (sum % 10)) % 10 === check;
}

const barcodeField = z
  .string()
  .trim()
  .transform(onlyDigits)
  .refine((value) => value === "" || isValidBarcode(value), {
    message: "Código de barras inválido: confira o dígito verificador.",
  })
  .transform((value) => (value === "" ? undefined : value))
  .optional();

/* -------------------------------------------------------------------------- */
/* Unidades de medida                                                          */
/* -------------------------------------------------------------------------- */

export const unitSchema = z.object({
  code: codeField("Código", 6),
  name: nameField("Nome"),
  allowsDecimals: z.boolean().default(false),
  active: z.boolean().default(true),
});

export type UnitInput = z.infer<typeof unitSchema>;

export const updateUnitSchema = unitSchema.extend({
  unitId: z.string().trim().min(1),
});

/* -------------------------------------------------------------------------- */
/* Categorias                                                                  */
/* -------------------------------------------------------------------------- */

export const categorySchema = z.object({
  code: codeField("Código", 30),
  name: nameField("Nome"),
  description: optionalText(300),
  parentId: optionalText(40),
  requiresApproval: z.boolean().default(false),
  active: z.boolean().default(true),
});

export type CategoryInput = z.infer<typeof categorySchema>;

export const updateCategorySchema = categorySchema.extend({
  categoryId: z.string().trim().min(1),
});

/* -------------------------------------------------------------------------- */
/* Itens                                                                       */
/* -------------------------------------------------------------------------- */

export const itemSchema = z
  .object({
    // Sem `code`: o identificador do material é sempre gerado pelo servidor a
    // partir do prefixo da categoria (`EPI-0007`). Ninguém digita código de
    // item — a única exceção são os códigos de categoria e unidade de medida,
    // que são tabelas de referência curtas e controladas pelo administrador.
    barcode: barcodeField,
    name: nameField("Nome", 160),
    description: optionalText(600),
    categoryId: z.string().trim().min(1, "Selecione a categoria."),
    unitId: z.string().trim().min(1, "Selecione a unidade de medida."),
    referencePrice: z.coerce
      .number()
      .nonnegative("O preço de referência não pode ser negativo.")
      .max(9_999_999, "Valor muito alto.")
      .default(0),
    controlledByLot: z.boolean().default(false),
    perishable: z.boolean().default(false),
    requiresApproval: z.boolean().default(false),
    hasSerialControl: z.boolean().default(false),
    // Só vale com `hasSerialControl`: o serviço zera quando o material não tem
    // número de série (por isso não há refine aqui).
    trackAsAsset: z.boolean().default(true),
    active: z.boolean().default(true),
  })
  .refine((data) => !data.perishable || data.controlledByLot, {
    message: "Material perecível exige controle por lote.",
    path: ["controlledByLot"],
  });

export type ItemInput = z.infer<typeof itemSchema>;

/**
 * Cadastro pelo caminho da doca: só o que é estritamente necessário.
 *
 * Usado quando o material nasce da leitura do código de barras — o usuário não
 * escolhe categoria (cai em "Geral"), não digita SKU (o servidor gera) e não
 * precisa preencher preço, descrição nem controles de lote. Tudo isso continua
 * editável depois, na tela completa do material.
 */
export const itemQuickSchema = z.object({
  name: nameField("Nome", 160),
  unitId: z.string().trim().min(1, "Selecione a unidade de medida."),
  barcode: barcodeField,
});

export type ItemQuickInput = z.infer<typeof itemQuickSchema>;

export const itemUpdateSchema = z
  .object({
    itemId: z.string().trim().min(1),
    // O `code` é gerado pelo servidor e imutável — não é campo de edição.
    barcode: barcodeField,
    name: nameField("Nome", 160),
    description: optionalText(600),
    categoryId: z.string().trim().min(1, "Selecione a categoria."),
    unitId: z.string().trim().min(1, "Selecione a unidade de medida."),
    referencePrice: z.coerce.number().nonnegative().max(9_999_999).default(0),
    controlledByLot: z.boolean().default(false),
    perishable: z.boolean().default(false),
    requiresApproval: z.boolean().default(false),
    hasSerialControl: z.boolean().default(false),
    trackAsAsset: z.boolean().default(true),
    active: z.boolean().default(true),
  })
  .refine((data) => !data.perishable || data.controlledByLot, {
    message: "Material perecível exige controle por lote.",
    path: ["controlledByLot"],
  });

export type ItemUpdateInput = z.infer<typeof itemUpdateSchema>;

/* -------------------------------------------------------------------------- */
/* Lotes                                                                       */
/* -------------------------------------------------------------------------- */

export const itemLotSchema = z.object({
  itemId: z.string().trim().min(1),
  code: z.string().trim().min(1, "Informe o código do lote.").max(40),
  expirationDate: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === "" || value === undefined ? undefined : new Date(value)))
    .refine((value) => value === undefined || !Number.isNaN(value.getTime()), {
      message: "Data de validade inválida.",
    }),
  active: z.boolean().default(true),
});

export type ItemLotInput = z.infer<typeof itemLotSchema>;

/* -------------------------------------------------------------------------- */
/* Política de estoque por filial                                              */
/* -------------------------------------------------------------------------- */

export const itemStockPolicySchema = z
  .object({
    itemId: z.string().trim().min(1),
    branchIds: z.array(z.string().trim().min(1)).min(1, "Selecione ao menos uma unidade."),
    minimumQuantity: z.coerce.number().nonnegative("O mínimo não pode ser negativo.").default(0),
    maximumQuantity: z.coerce.number().nonnegative().optional(),
    alertQuantity: z.coerce.number().nonnegative().optional(),
    averageConsumption: z.coerce.number().nonnegative().optional(),
  })
  .refine(
    (data) =>
      data.maximumQuantity === undefined ||
      data.maximumQuantity === 0 ||
      data.maximumQuantity >= data.minimumQuantity,
    { message: "O máximo não pode ser menor que o mínimo.", path: ["maximumQuantity"] },
  );

export type ItemStockPolicyInput = z.infer<typeof itemStockPolicySchema>;

/** Prefixos sugeridos para geração automática de SKU por categoria. */
export const CATEGORY_CODE_SUGGESTION: Record<string, string> = {
  EPI: "EPI",
  LIMPEZA: "LMP",
  ESCRITORIO: "ESC",
  CONSUMO: "CNS",
  FERRAMENTAS: "FER",
  MANUTENCAO: "MAN",
};
