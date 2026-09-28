import { z } from "zod";

import { isValidCnpj, isValidPhone, isValidZipCode, UF_CODES } from "@/lib/validation/br";
import { isValidEmailShape, normalizeEmail } from "@/lib/email-policy";
import { onlyDigits } from "@/lib/format";

/** Validações do cadastro de filial (docs/ARQUITETURA.md §2). */

const requiredText = (label: string, max = 120) =>
  z.string().trim().min(1, `${label} é obrigatório.`).max(max, `${label} é muito longo.`);

const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === "" ? undefined : value));

const cnpjField = z
  .string()
  .trim()
  .transform(onlyDigits)
  .refine(isValidCnpj, "Informe um CNPJ válido.");

const optionalCnpjField = z
  .string()
  .trim()
  .transform(onlyDigits)
  .refine((value) => value === "" || isValidCnpj(value), "Informe um CNPJ válido.")
  .transform((value) => (value === "" ? undefined : value))
  .optional();

export const branchTypeSchema = z.enum(["MATRIX", "BRANCH"]);

export const storageLocationTypeSchema = z.enum([
  "MAIN_WAREHOUSE",
  "SECONDARY",
  "QUARANTINE",
  "TOOLS",
  "OTHER",
]);

const businessHoursSchema = z
  .record(
    z.string(),
    z.object({
      open: z.string().max(5),
      close: z.string().max(5),
    }),
  )
  .optional();

/** Campos comuns entre criação e edição. */
const branchCore = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, "Use de 2 a 20 caracteres: letras, números e hífen."),
  name: requiredText("Nome da unidade"),
  type: branchTypeSchema,
  legalName: optionalText(160),
  tradeName: optionalText(160),
  stateRegistration: optionalText(20),
  cnae: z
    .string()
    .trim()
    .transform(onlyDigits)
    .refine((value) => value === "" || value.length === 7, "O CNAE tem 7 dígitos.")
    .transform((value) => (value === "" ? undefined : value))
    .optional(),

  // Endereço
  zipCode: z
    .string()
    .trim()
    .transform(onlyDigits)
    .refine((value) => value === "" || isValidZipCode(value), "Informe um CEP válido.")
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  street: optionalText(160),
  number: optionalText(20),
  complement: optionalText(80),
  district: optionalText(80),
  city: optionalText(80),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .refine(
      (value) => value === "" || (UF_CODES as readonly string[]).includes(value),
      "Selecione uma UF válida.",
    )
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  country: z.string().trim().max(60).default("Brasil"),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),

  // Contato
  email: z
    .string()
    .trim()
    .transform(normalizeEmail)
    .refine((value) => value === "" || isValidEmailShape(value), "Informe um e-mail válido.")
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  phone: z
    .string()
    .trim()
    .refine((value) => value === "" || isValidPhone(value), "Informe um telefone válido com DDD.")
    .transform((value) => (value === "" ? undefined : onlyDigits(value)))
    .optional(),
  whatsapp: z
    .string()
    .trim()
    .refine((value) => value === "" || isValidPhone(value), "Informe um telefone válido com DDD.")
    .transform((value) => (value === "" ? undefined : onlyDigits(value)))
    .optional(),

  // Responsáveis
  legalResponsibleId: optionalText(40),
  legalResponsibleName: optionalText(120),
  legalResponsibleDocument: z
    .string()
    .trim()
    .transform(onlyDigits)
    .refine(
      (value) => value === "" || value.length === 11 || value.length === 14,
      "Informe CPF (11) ou CNPJ (14) dígitos.",
    )
    .transform((value) => (value === "" ? undefined : value))
    .optional(),
  warehouseResponsibleId: optionalText(40),
  notificationResponsibleId: optionalText(40),
  defaultApproverId: optionalText(40),

  businessHours: businessHoursSchema,
  notes: optionalText(600),
  parentId: optionalText(40),
  active: z.boolean().default(true),
};

export const createBranchSchema = z
  .object({
    ...branchCore,
    cnpj: cnpjField,
  })
  .refine((data) => data.state === undefined || data.city !== undefined, {
    message: "Informe a cidade ao preencher a UF.",
    path: ["city"],
  });

export type CreateBranchInput = z.infer<typeof createBranchSchema>;

export const updateBranchSchema = z
  .object({
    ...branchCore,
    branchId: z.string().trim().min(1),
    cnpj: optionalCnpjField,
  })
  .refine((data) => data.state === undefined || data.city !== undefined, {
    message: "Informe a cidade ao preencher a UF.",
    path: ["city"],
  });

export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

export const deactivateBranchSchema = z.object({
  branchId: z.string().trim().min(1),
  reason: z.string().trim().max(500).optional(),
});

export const storageLocationSchema = z.object({
  branchId: z.string().trim().min(1),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,20}$/, "Use de 2 a 20 caracteres: letras, números e hífen."),
  name: requiredText("Nome do local", 120),
  type: storageLocationTypeSchema.default("MAIN_WAREHOUSE"),
  description: optionalText(300),
  responsibleId: optionalText(40),
  active: z.boolean().default(true),
});

export type StorageLocationInput = z.infer<typeof storageLocationSchema>;

export const updateStorageLocationSchema = storageLocationSchema.extend({
  locationId: z.string().trim().min(1),
});

/** Blocos do wizard de cadastro, para a interface montar os passos. */
export const BRANCH_FORM_STEPS = [
  {
    id: "identificacao",
    title: "Identificação",
    description: "Código, nome e dados fiscais da unidade.",
  },
  {
    id: "endereco",
    title: "Endereço e contato",
    description: "Onde a unidade fica e como falar com ela.",
  },
  {
    id: "operacao",
    title: "Responsáveis e operação",
    description: "Quem responde pela unidade e pelo almoxarifado.",
  },
] as const;
