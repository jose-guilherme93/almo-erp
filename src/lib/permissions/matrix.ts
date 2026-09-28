/**
 * Matriz papel × permissão dos papéis de sistema.
 *
 * Bate exatamente com `docs/ARQUITETURA.md` §3.2. É usada pelo seed e pelos
 * testes de autorização, que comparam papel a papel.
 *
 * Papéis customizados criados na interface não passam por aqui — eles vivem
 * apenas no banco.
 */
import { PERMISSION_KEYS, type PermissionKey } from "@/lib/permissions/catalog";

export const ROLE_SLUGS = [
  "SUPER_ADMIN",
  "ADMIN_MATRIZ",
  "ADMIN_FILIAL",
  "GESTOR",
  "ALMOXARIFE",
  "SOLICITANTE",
  "CONSULTA",
] as const;

export type RoleSlug = (typeof ROLE_SLUGS)[number];

export type RoleDefinition = {
  slug: RoleSlug;
  name: string;
  description: string;
  scope: "ALL_BRANCHES" | "OWN_BRANCHES";
  /** Lista explícita de permissões; `"*"` concede todas. */
  permissions: readonly PermissionKey[] | "*";
};

const ALL = PERMISSION_KEYS as readonly PermissionKey[];

/** Permissões administrativas que só o SUPER_ADMIN possui. */
const SUPER_ADMIN_ONLY: readonly PermissionKey[] = [
  "papel:manage",
  "politica-email:manage",
  "configuracao:manage",
];

const ADMIN_MATRIZ: readonly PermissionKey[] = ALL.filter((key) => !SUPER_ADMIN_ONLY.includes(key));

const ADMIN_FILIAL: readonly PermissionKey[] = [
  "filial:read",
  "local:read",
  "local:manage",
  "categoria:read",
  "unidade-medida:read",
  "item:read",
  "item:create",
  "item:update",
  "item:manage",
  "estoque:read",
  "estoque:entrada",
  "estoque:saida",
  "estoque:ajuste",
  "solicitacao:read",
  "solicitacao:create",
  "solicitacao:approve",
  "solicitacao:entregar",
  "transferencia:read",
  "transferencia:create",
  "transferencia:enviar",
  "transferencia:receber",
  "inventario:read",
  "inventario:manage",
  "manutencao:read",
  "manutencao:create",
  "manutencao:atender",
  "manutencao:manage",
  "relatorio:read",
  "usuario:read",
  "usuario:manage",
  "notificacao:read",
];

const GESTOR: readonly PermissionKey[] = [
  "filial:read",
  "local:read",
  "categoria:read",
  "unidade-medida:read",
  "item:read",
  "estoque:read",
  "solicitacao:read",
  "solicitacao:create",
  "solicitacao:approve",
  "transferencia:read",
  "transferencia:receber",
  "inventario:read",
  "manutencao:read",
  "manutencao:create",
  "manutencao:atender",
  "relatorio:read",
  "usuario:read",
  "notificacao:read",
];

const ALMOXARIFE: readonly PermissionKey[] = [
  "filial:read",
  "local:read",
  "local:manage",
  "categoria:read",
  "unidade-medida:read",
  "item:read",
  "estoque:read",
  "estoque:entrada",
  "estoque:saida",
  "estoque:ajuste",
  "solicitacao:read",
  "solicitacao:create",
  "solicitacao:entregar",
  "transferencia:read",
  "transferencia:create",
  "transferencia:enviar",
  "transferencia:receber",
  "inventario:read",
  "inventario:manage",
  "manutencao:read",
  "manutencao:create",
  "manutencao:atender",
  "relatorio:read",
  "notificacao:read",
];

const SOLICITANTE: readonly PermissionKey[] = [
  "categoria:read",
  "unidade-medida:read",
  "item:read",
  "estoque:read",
  "solicitacao:read",
  "solicitacao:create",
  "transferencia:read",
  "manutencao:read",
  "manutencao:create",
  "notificacao:read",
];

const CONSULTA: readonly PermissionKey[] = [
  "filial:read",
  "local:read",
  "categoria:read",
  "unidade-medida:read",
  "item:read",
  "estoque:read",
  "solicitacao:read",
  "transferencia:read",
  "inventario:read",
  "manutencao:read",
  "relatorio:read",
  "notificacao:read",
];

export const ROLES: readonly RoleDefinition[] = [
  {
    slug: "SUPER_ADMIN",
    name: "Super administrador",
    description:
      "Acesso total ao sistema. Único papel que administra papéis, políticas de e-mail e configurações.",
    scope: "ALL_BRANCHES",
    permissions: "*",
  },
  {
    slug: "ADMIN_MATRIZ",
    name: "Administrador da matriz",
    description:
      "Administra a rede: todas as filiais, mínimos, transferências, estoque consolidado e usuários.",
    scope: "ALL_BRANCHES",
    permissions: ADMIN_MATRIZ,
  },
  {
    slug: "ADMIN_FILIAL",
    name: "Administrador da unidade",
    description:
      "Administra uma unidade: catálogo local, usuários da filial, aprovações, entregas e inventário.",
    scope: "OWN_BRANCHES",
    permissions: ADMIN_FILIAL,
  },
  {
    slug: "GESTOR",
    name: "Gestor",
    description:
      "Aprova e rejeita solicitações da unidade, recebe transferências e acompanha relatórios.",
    scope: "OWN_BRANCHES",
    permissions: GESTOR,
  },
  {
    slug: "ALMOXARIFE",
    name: "Almoxarife",
    description:
      "Opera o almoxarifado: entradas, saídas, ajustes, transferências, entregas e inventário.",
    scope: "OWN_BRANCHES",
    permissions: ALMOXARIFE,
  },
  {
    slug: "SOLICITANTE",
    name: "Solicitante",
    description: "Cria e acompanha as próprias solicitações de material.",
    scope: "OWN_BRANCHES",
    permissions: SOLICITANTE,
  },
  {
    slug: "CONSULTA",
    name: "Consulta",
    description: "Acesso somente leitura aos dados da própria unidade.",
    scope: "OWN_BRANCHES",
    permissions: CONSULTA,
  },
];

/** Permissões efetivas de um papel de sistema, já resolvendo o coringa `"*"`. */
export function permissionsForRole(slug: RoleSlug): readonly PermissionKey[] {
  const role = ROLES.find((entry) => entry.slug === slug);
  if (!role) return [];

  return role.permissions === "*" ? ALL : role.permissions;
}

export function isRoleSlug(value: string): value is RoleSlug {
  return (ROLE_SLUGS as readonly string[]).includes(value);
}
