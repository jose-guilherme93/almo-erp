import type { PermissionKey } from "@/lib/permissions/catalog";

/**
 * Navegação lateral, montada por permissão e na ordem em que o trabalho acontece.
 *
 * Cada item declara a permissão mínima. O item que o usuário não pode acessar
 * **não aparece** — a decisão real continua no servidor, isto é só UX.
 *
 * A ordem dos grupos não é alfabética nem segue o modelo de dados: segue o dia de
 * quem opera o almoxarifado. Primeiro o que tem decisão pendente (Ação), depois o
 * material que entra (Insumo), o que sai (Consumo), a Manutenção, o
 * Monitoramento e, por último, Configurações.
 *
 * Nenhum `href` aparece em dois grupos: o mesmo endereço duas vezes no menu é
 * exatamente o tipo de ruído que esta navegação veio para tirar.
 */

export type NavItem = {
  label: string;
  href: string;
  permission: PermissionKey;
  /** Exige escopo de rede (matriz). */
  networkOnly?: boolean;
  /** Só faz sentido com 2+ unidades ativas (transferência entre almoxarifados). */
  requiresNetwork?: boolean;
  description?: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAVIGATION: NavGroup[] = [
  {
    // O que precisa de decisão ou de movimento hoje.
    label: "Ação",
    items: [
      {
        label: "Aprovar pedidos",
        href: "/solicitacoes/fila",
        permission: "solicitacao:approve",
        description: "Pedidos aguardando sua decisão",
      },
      {
        label: "Entregar",
        href: "/entregas",
        permission: "solicitacao:entregar",
        description: "Separar e entregar o que foi aprovado",
      },
      {
        label: "Chamados abertos",
        href: "/reparos",
        permission: "manutencao:atender",
        description: "Reparo e TI",
      },
    ],
  },
  {
    // Mais embaixo: o material chega e é guardado.
    label: "Insumo",
    items: [
      {
        label: "Registrar entrada",
        href: "/estoque/entradas/nova",
        permission: "estoque:entrada",
        description: "Ler o código de barras e dar entrada",
      },
      { label: "Ajustes", href: "/estoque/ajustes", permission: "estoque:ajuste" },
      { label: "Inventário", href: "/inventario", permission: "inventario:read" },
    ],
  },
  {
    // Mais em cima: o material sai porque alguém pediu.
    label: "Consumo",
    items: [
      { label: "Pedidos de material", href: "/solicitacoes", permission: "solicitacao:read" },
      {
        label: "Fazer um pedido",
        href: "/solicitar",
        permission: "solicitacao:create",
        description: "Material, reparo ou TI",
      },
    ],
  },
  {
    label: "Manutenção",
    items: [
      {
        label: "Abrir chamado",
        href: "/reparos/novo",
        permission: "manutencao:create",
        description: "Reparo ou TI",
      },
      { label: "Meus chamados", href: "/meu", permission: "manutencao:read" },
    ],
  },
  {
    // Ver o que está acontecendo, sem sair para a planilha.
    label: "Monitoramento",
    items: [
      { label: "Saldos", href: "/estoque/saldos", permission: "estoque:read" },
      { label: "Movimentações", href: "/estoque/movimentacoes", permission: "estoque:read" },
      { label: "Relatórios", href: "/relatorios", permission: "relatorio:read" },
      {
        label: "Dashboard",
        href: "/dashboard",
        permission: "relatorio:read",
        networkOnly: true,
        description: "Indicadores de toda a rede",
      },
    ],
  },
  {
    // O que se ajusta de vez em quando.
    label: "Configurações",
    items: [
      { label: "Materiais", href: "/catalogo/itens", permission: "item:read" },
      { label: "Unidades", href: "/filiais", permission: "filial:read" },
      { label: "Usuários", href: "/admin/usuarios", permission: "usuario:read" },
    ],
  },
];

/**
 * Configuração avançada.
 *
 * Fica fora do menu principal de propósito: são telas de ajuste raro (categorias,
 * unidades de medida, papéis, políticas de e-mail, auditoria). Continuam
 * acessíveis por URL e pelos links das próprias telas.
 */
export const ADVANCED_NAVIGATION: NavGroup = {
  label: "Avançado",
  items: [
    {
      label: "Transferências",
      href: "/transferencias",
      permission: "transferencia:read",
      // Transferência entre unidades não tem o que fazer numa rede de uma só.
      requiresNetwork: true,
      description: "Mover material de uma unidade para outra",
    },
    { label: "Categorias", href: "/catalogo/categorias", permission: "categoria:read" },
    { label: "Unidades de medida", href: "/catalogo/unidades", permission: "unidade-medida:read" },
    { label: "Perfis e permissões", href: "/admin/papeis", permission: "papel:read" },
    {
      label: "Auditoria",
      href: "/admin/auditoria",
      permission: "papel:manage",
    },
    {
      label: "Erros",
      href: "/admin/erros",
      permission: "papel:manage",
      description: "Erros de servidor capturados",
    },
    {
      label: "Políticas de e-mail",
      href: "/admin/politicas-email",
      permission: "politica-email:read",
    },
  ],
};

/**
 * Itens visíveis para o usuário, já filtrados por permissão e escopo.
 *
 * `activeBranchCount` decide o que é ruído: numa instalação de uma unidade só,
 * transferência entre unidades não aparece.
 */
export function visibleNavigation(
  hasPermission: (permission: string) => boolean,
  isNetworkScope: boolean,
  activeBranchCount: number,
): NavGroup[] {
  const show = (item: NavItem) => {
    if (item.networkOnly && !isNetworkScope) return false;
    if (item.requiresNetwork && activeBranchCount < 2) return false;
    return hasPermission(item.permission);
  };

  return [...NAVIGATION, ADVANCED_NAVIGATION]
    .map((group) => ({ ...group, items: group.items.filter(show) }))
    .filter((group) => group.items.length > 0);
}
