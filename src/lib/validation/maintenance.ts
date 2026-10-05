import { z } from "zod";

/** Validação do chamado de reparo. */

export const MAINTENANCE_CATEGORIES = [
  { value: "ELECTRICAL", label: "Elétrica", hint: "Tomada, disjuntor, iluminação" },
  { value: "PLUMBING", label: "Hidráulica", hint: "Vazamento, torneira, esgoto" },
  { value: "HVAC", label: "Ar-condicionado", hint: "Climatização e ventilação" },
  { value: "FURNITURE", label: "Mobiliário", hint: "Mesa, cadeira, armário" },
  { value: "CIVIL", label: "Alvenaria e estrutura", hint: "Parede, piso, telhado" },
  { value: "IT", label: "Informática e redes", hint: "Computador, rede, telefonia" },
  { value: "EQUIPMENT", label: "Equipamentos", hint: "Máquina, ferramenta, eletrodoméstico" },
  { value: "CLEANING", label: "Limpeza e conservação", hint: "Áreas comuns e fachada" },
  { value: "OTHER", label: "Outros", hint: "Não se encaixa nas opções acima" },
] as const;

export const MAINTENANCE_PRIORITIES = [
  { value: "LOW", label: "Baixa", hint: "pode esperar" },
  { value: "NORMAL", label: "Normal", hint: "prazo habitual" },
  { value: "HIGH", label: "Alta", hint: "atender logo" },
  { value: "URGENT", label: "Urgente", hint: "atrapalha a operação agora" },
] as const;

const categoryValues = MAINTENANCE_CATEGORIES.map((category) => category.value);

export const maintenanceCreateSchema = z.object({
  branchId: z.string().trim().min(1, "Escolha a unidade."),
  sectorId: z.string().trim().optional(),
  category: z.enum(categoryValues, { message: "Escolha o tipo de problema." }),
  title: z
    .string()
    .trim()
    .min(5, "Resuma o problema em poucas palavras (mínimo 5 caracteres).")
    .max(120, "O resumo é muito longo."),
  description: z
    .string()
    .trim()
    .min(15, "Descreva o problema com um pouco mais de detalhe (mínimo 15 caracteres).")
    .max(1500, "A descrição é muito longa."),
  location: z
    .string()
    .trim()
    .min(2, "Informe onde está o problema (sala, andar, setor).")
    .max(120, "O local é muito longo."),
  assetTag: z.string().trim().max(60).optional(),
});

export type MaintenanceCreateInput = z.infer<typeof maintenanceCreateSchema>;

export const maintenancePrioritySchema = z.object({
  requestId: z.string().trim().min(1),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"], {
    message: "Escolha a prioridade.",
  }),
  comment: z.string().trim().max(400).optional(),
});

export const assignMaintenanceSchema = z.object({
  requestId: z.string().trim().min(1),
  assignedToId: z.string().trim().min(1, "Escolha quem vai atender."),
  comment: z.string().trim().max(400).optional(),
});

export const maintenanceProgressSchema = z.object({
  requestId: z.string().trim().min(1),
  status: z.enum(["IN_PROGRESS", "WAITING_PARTS"]),
  comment: z.string().trim().min(5, "Descreva o andamento.").max(600),
});

export const maintenanceCompleteSchema = z.object({
  requestId: z.string().trim().min(1),
  resolution: z
    .string()
    .trim()
    .min(10, "Descreva o que foi feito (mínimo 10 caracteres).")
    .max(1500),
});

export const maintenanceRejectSchema = z.object({
  requestId: z.string().trim().min(1),
  reason: z.string().trim().min(5, "Explique o motivo da recusa.").max(600),
});
