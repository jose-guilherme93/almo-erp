import { z } from "zod";

import { isValidEmailShape, normalizeEmail } from "@/lib/email-policy";

const emailField = z
  .string()
  .trim()
  .min(1, "Informe o e-mail.")
  .transform(normalizeEmail)
  .refine(isValidEmailShape, "Informe um e-mail válido.");

const nameField = z
  .string()
  .trim()
  .min(2, "O nome precisa ter ao menos 2 caracteres.")
  .max(120, "O nome é muito longo.");

const cpfField = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D+/g, ""))
  .refine((value) => value === "" || value.length === 11, "O documento precisa ter 11 dígitos.")
  .optional();

export const userStatusSchema = z.enum(["PENDING", "ACTIVE", "SUSPENDED", "INACTIVE"]);

export const roleScopeSchema = z.enum(["ALL_BRANCHES", "OWN_BRANCHES"]);

/**
 * Setor do vínculo (opcional).
 *
 * Define de qual setor a pessoa faz parte naquela unidade — é o que roteia
 * chamados de atendimento para o setor certo (ex.: TI) e libera a visibilidade
 * das demandas encaminhadas/roteadas a ele.
 */
const sectorIdField = z.string().trim().min(1).optional();

/** Criação de usuário pelo administrador. */
export const createUserSchema = z.object({
  name: nameField,
  email: emailField,
  roleId: z.string().trim().min(1, "Selecione um perfil."),
  branchIds: z
    .array(z.string().trim().min(1))
    .min(1, "Selecione ao menos uma unidade.")
    .max(50, "Selecione menos unidades."),
  sectorId: sectorIdField,
  activateNow: z.boolean().default(false),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  userId: z.string().trim().min(1),
  name: nameField,
  active: z.boolean().default(true),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const addMembershipSchema = z.object({
  userId: z.string().trim().min(1),
  branchId: z.string().trim().min(1, "Selecione a unidade."),
  roleId: z.string().trim().min(1, "Selecione o perfil."),
  sectorId: sectorIdField,
  isDefault: z.boolean().default(false),
});

export const updateMembershipSchema = z.object({
  membershipId: z.string().trim().min(1),
  roleId: z.string().trim().min(1, "Selecione um perfil."),
  sectorId: sectorIdField,
  isDefault: z.boolean().default(false),
});

export const removeMembershipSchema = z.object({
  membershipId: z.string().trim().min(1),
});

export const changeUserStatusSchema = z.object({
  userId: z.string().trim().min(1),
  status: userStatusSchema,
  reason: z.string().trim().max(500).optional(),
});

export const inviteUserSchema = z.object({
  email: emailField,
  branchId: z.string().trim().min(1),
  roleId: z.string().trim().min(1),
});

export const profileSchema = z.object({
  name: nameField,
  document: cpfField,
});

// -----------------------------------------------------------------------------
// Papéis
// -----------------------------------------------------------------------------

export const createRoleSchema = z.object({
  name: z.string().trim().min(3, "O nome do perfil precisa ter ao menos 3 caracteres.").max(60),
  description: z.string().trim().max(300).optional(),
  scope: roleScopeSchema,
  permissions: z.array(z.string().trim().min(1)).max(200).default([]),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = createRoleSchema.extend({
  roleId: z.string().trim().min(1),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

// -----------------------------------------------------------------------------
// Políticas de e-mail
// -----------------------------------------------------------------------------

export const emailPolicySchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Informe o domínio.")
    .regex(
      /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/,
      "Informe um domínio válido, como exemplo.com.br (sem @ e sem http).",
    ),
  pattern: z
    .string()
    .trim()
    .max(300)
    .optional()
    .refine((value) => validatePattern(value ?? "") === null, {
      message: "Expressão regular inválida.",
    }),
  autoApprove: z.boolean().default(false),
  defaultRoleId: z.string().trim().optional(),
  defaultBranchId: z.string().trim().optional(),
  active: z.boolean().default(true),
});

export type EmailPolicyInput = z.infer<typeof emailPolicySchema>;

export const updateEmailPolicySchema = emailPolicySchema.extend({
  policyId: z.string().trim().min(1),
});

/**
 * Valida a regex do `pattern` e devolve mensagem de erro legível.
 * Usada no formulário antes de salvar (FASE 03.6).
 */
export function validatePattern(pattern: string): string | null {
  if (pattern.trim() === "") return null;

  try {
    new RegExp(pattern);
    return null;
  } catch {
    return "Expressão regular inválida.";
  }
}
