/**
 * Catálogo de permissões — FONTE ÚNICA DE VERDADE.
 *
 * Toda permissão do sistema nasce aqui. O seed da FASE 01 grava este catálogo
 * na tabela `permissions`, a tela de papéis (FASE 03) o agrupa para edição, e
 * as Server Actions validam contra `isPermissionKey()`.
 *
 * Formato da chave: `<recurso>:<ação>`.
 */

export const PERMISSION_GROUPS = [
  "Filiais",
  "Catálogo",
  "Estoque",
  "Solicitações",
  "Transferências",
  "Inventário",
  "Manutenção",
  "Relatórios",
  "Administração",
  "Notificações",
] as const;

export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

export type PermissionDefinition = {
  key: string;
  resource: string;
  action: string;
  group: PermissionGroup;
  description: string;
};

function define(
  resource: string,
  action: string,
  group: PermissionGroup,
  description: string,
): PermissionDefinition {
  return { key: `${resource}:${action}`, resource, action, group, description };
}

export const PERMISSIONS = [
  // --- Filiais ---
  define("filial", "read", "Filiais", "Ver os dados da própria filial"),
  define("filial", "create", "Filiais", "Cadastrar novas filiais"),
  define("filial", "update", "Filiais", "Editar dados da filial"),
  define("filial", "manage", "Filiais", "Criar, editar, desativar e gerenciar filiais"),

  define("local", "read", "Filiais", "Ver os locais de estoque da filial"),
  define("local", "manage", "Filiais", "Criar e editar locais de estoque"),

  // --- Catálogo ---
  define("categoria", "read", "Catálogo", "Ver as categorias de material"),
  define("categoria", "manage", "Catálogo", "Criar e editar categorias de material"),

  define("unidade-medida", "read", "Catálogo", "Ver as unidades de medida"),
  define("unidade-medida", "manage", "Catálogo", "Criar e editar unidades de medida"),

  define("item", "read", "Catálogo", "Ver o catálogo de materiais"),
  define("item", "create", "Catálogo", "Cadastrar materiais"),
  define("item", "update", "Catálogo", "Editar materiais"),
  define("item", "manage", "Catálogo", "Criar, editar e desativar materiais"),

  // --- Estoque ---
  define("estoque", "read", "Estoque", "Consultar saldos e movimentações"),
  define("estoque", "entrada", "Estoque", "Lançar entradas de material"),
  define("estoque", "saida", "Estoque", "Lançar saídas de material"),
  define("estoque", "ajuste", "Estoque", "Lançar ajustes de estoque com justificativa"),

  // --- Solicitações ---
  define("solicitacao", "read", "Solicitações", "Ver solicitações da filial"),
  define("solicitacao", "create", "Solicitações", "Criar solicitações de material"),
  define(
    "solicitacao",
    "approve",
    "Solicitações",
    "Aprovar, aprovar parcialmente ou rejeitar solicitações",
  ),
  define("solicitacao", "entregar", "Solicitações", "Separar e entregar material solicitado"),

  // --- Transferências ---
  define("transferencia", "read", "Transferências", "Ver transferências entre unidades"),
  define("transferencia", "create", "Transferências", "Criar transferências entre unidades"),
  define("transferencia", "enviar", "Transferências", "Enviar transferências (baixa na origem)"),
  define(
    "transferencia",
    "receber",
    "Transferências",
    "Receber e conferir transferências (entrada no destino)",
  ),

  // --- Manutenção ---
  define("manutencao", "read", "Manutenção", "Ver os chamados de reparo"),
  define("manutencao", "create", "Manutenção", "Abrir chamados de reparo"),
  define("manutencao", "atender", "Manutenção", "Assumir, priorizar, atribuir e concluir chamados"),
  define("manutencao", "manage", "Manutenção", "Gerenciar o fluxo completo de manutenção"),

  // --- Inventário ---
  define("inventario", "read", "Inventário", "Consultar sessões de inventário"),
  define("inventario", "manage", "Inventário", "Criar, contar e fechar inventários"),

  // --- Relatórios ---
  define("relatorio", "read", "Relatórios", "Acessar relatórios e indicadores"),

  // --- Administração ---
  define("usuario", "read", "Administração", "Ver usuários e seus vínculos"),
  define("usuario", "manage", "Administração", "Criar, editar, vincular e suspender usuários"),
  define("papel", "read", "Administração", "Ver papéis e suas permissões"),
  define("papel", "manage", "Administração", "Criar e editar papéis e permissões"),
  define("politica-email", "read", "Administração", "Ver as políticas de e-mail corporativo"),
  define(
    "politica-email",
    "manage",
    "Administração",
    "Criar e editar políticas de e-mail corporativo",
  ),
  define("configuracao", "manage", "Administração", "Alterar as configurações do sistema"),

  // --- Notificações ---
  define("notificacao", "read", "Notificações", "Ver a própria caixa de notificações"),
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((permission) => permission.key);

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

/** Type guard para validar chaves vindas de formulário/banco. */
export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEY_SET.has(value);
}

/** Permissões agrupadas, na ordem de `PERMISSION_GROUPS` — para a tela de papéis. */
export function permissionsByGroup(): Array<{
  group: PermissionGroup;
  permissions: PermissionDefinition[];
}> {
  return PERMISSION_GROUPS.map((group) => ({
    group,
    permissions: PERMISSIONS.filter((permission) => permission.group === group),
  })).filter((entry) => entry.permissions.length > 0);
}
