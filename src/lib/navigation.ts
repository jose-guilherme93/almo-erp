import type { PermissionKey } from "@/lib/permissions/catalog";

/**
 * Navegação lateral, montada por permissão.
 *
 * Cada item declara a permissão mínima. O item que o usuário não pode acessar
 * **não aparece** — a decisão real continua no servidor, isto é só UX.
 */

export type NavItem = {
  label: string;
  href: string;
  permission: PermissionKey;
  /** Exige escopo de rede (matriz). */
  networkOnly?: boolean;
  description?: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAVIGATION: NavGroup[] = [
  {
    label: "Visão geral",
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        permission: "relatorio:read",
        networkOnly: true,
        description: "Indicadores de toda a rede",
      },
      {
        label: "Minhas solicitações",
        href: "/meu",
        permission: "notificacao:read",
        description: "Seus pedidos e entregas",
      },
      {
        label: "Notificações",
        href: "/notificacoes",
        permission: "notificacao:read",
      },
    ],
  },
  {
    label: "Operação",
    items: [
      {
        label: "Fazer um pedido",
        href: "/solicitar",
        permission: "solicitacao:create",
        description: "Material ou reparo",
      },
      {
        label: "Solicitações",
        href: "/solicitacoes",
        permission: "solicitacao:read",
      },
      {
        label: "Reparos",
        href: "/reparos",
        permission: "manutencao:read",
      },
      {
        label: "Fila de aprovação",
        href: "/solicitacoes/fila",
        permission: "solicitacao:approve",
      },
      {
        label: "Entregas",
        href: "/entregas",
        permission: "solicitacao:entregar",
      },
    ],
  },
  {
    label: "Estoque",
    items: [
      { label: "Saldos", href: "/estoque/saldos", permission: "estoque:read" },
      {
        label: "Movimentações",
        href: "/estoque/movimentacoes",
        permission: "estoque:read",
      },
      { label: "Entradas", href: "/estoque/entradas", permission: "estoque:entrada" },
      { label: "Ajustes", href: "/estoque/ajustes", permission: "estoque:ajuste" },
      {
        label: "Transferências",
        href: "/transferencias",
        permission: "transferencia:read",
      },
      { label: "Inventário", href: "/inventario", permission: "inventario:read" },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { label: "Materiais", href: "/catalogo/itens", permission: "item:read" },
      {
        label: "Categorias",
        href: "/catalogo/categorias",
        permission: "categoria:read",
      },
      {
        label: "Unidades de medida",
        href: "/catalogo/unidades",
        permission: "unidade-medida:read",
      },
      { label: "Unidades", href: "/filiais", permission: "filial:read" },
    ],
  },
  {
    label: "Análise",
    items: [{ label: "Relatórios", href: "/relatorios", permission: "relatorio:read" }],
  },
  {
    label: "Administração",
    items: [
      { label: "Usuários", href: "/admin/usuarios", permission: "usuario:read" },
      { label: "Perfis e permissões", href: "/admin/papeis", permission: "papel:read" },
      {
        label: "Políticas de e-mail",
        href: "/admin/politicas-email",
        permission: "politica-email:read",
      },
      {
        label: "Auditoria",
        href: "/admin/auditoria",
        permission: "papel:manage",
      },
    ],
  },
];

/** Itens visíveis para o usuário, já filtrados por permissão e escopo. */
export function visibleNavigation(
  hasPermission: (permission: string) => boolean,
  isNetworkScope: boolean,
): NavGroup[] {
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.networkOnly && !isNetworkScope) return false;
      return hasPermission(item.permission);
    }),
  })).filter((group) => group.items.length > 0);
}
