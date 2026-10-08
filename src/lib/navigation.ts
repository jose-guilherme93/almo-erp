import type { PermissionKey } from "@/lib/permissions/catalog";

/**
 * Navegação lateral, montada por permissão e na ordem em que o trabalho acontece.
 *
 * Cada item declara a permissão mínima. O item que o usuário não pode acessar
 * **não aparece** — a decisão real continua no servidor, isto é só UX.
 *
 * A ordem não é alfabética nem segue o modelo de dados: o **Início** (painel de
 * quem entrou) fica no topo, depois o que tem decisão pendente (Ação), o
 * material que entra (Insumo), o que sai (Consumo), os chamados (Manutenção), o
 * Monitoramento e, por último, as Configurações.
 *
 * Nenhum `href` aparece em dois grupos: o mesmo endereço duas vezes no menu é
 * exatamente o tipo de ruído que esta navegação veio para tirar.
 */

export type NavItem = {
  label: string;
  href: string;
  /**
   * Permissão mínima para o item aparecer. Ausente = visível a qualquer usuário
   * logado (é o caso do painel pessoal, `/meu`, que não exige permissão).
   */
  permission?: PermissionKey;
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
    // O material chega, é guardado e movimentado.
    label: "Insumo",
    items: [
      {
        label: "Registrar entrada",
        href: "/estoque/entradas/nova",
        permission: "estoque:entrada",
        description: "Ler o código de barras e dar entrada",
      },
      { label: "Ajustes", href: "/estoque/ajustes", permission: "estoque:ajuste" },
      {
        label: "Transferências",
        href: "/transferencias",
        permission: "transferencia:read",
        // Transferência entre unidades não tem o que fazer numa rede de uma só.
        requiresNetwork: true,
        description: "Mover material de uma unidade para outra",
      },
      { label: "Inventário", href: "/inventario", permission: "inventario:read" },
    ],
  },
  {
    // O material sai porque alguém pediu.
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
    ],
  },
  {
    // Ver o que está acontecendo, sem sair para a planilha.
    label: "Monitoramento",
    items: [
      { label: "Saldos", href: "/estoque/saldos", permission: "estoque:read" },
      { label: "Movimentações", href: "/estoque/movimentacoes", permission: "estoque:read" },
      { label: "Relatórios", href: "/relatorios", permission: "relatorio:read" },
    ],
  },
  {
    // O que se ajusta de vez em quando — catálogo e administração, no rodapé.
    label: "Configurações",
    items: [
      { label: "Materiais", href: "/catalogo/itens", permission: "item:read" },
      { label: "Unidades", href: "/filiais", permission: "filial:read" },
      { label: "Categorias", href: "/catalogo/categorias", permission: "categoria:read" },
      {
        label: "Unidades de medida",
        href: "/catalogo/unidades",
        permission: "unidade-medida:read",
      },
      { label: "Usuários", href: "/admin/usuarios", permission: "usuario:read" },
      { label: "Perfis e permissões", href: "/admin/papeis", permission: "papel:read" },
      {
        label: "Políticas de e-mail",
        href: "/admin/politicas-email",
        permission: "politica-email:read",
      },
      { label: "Auditoria", href: "/admin/auditoria", permission: "papel:manage" },
      {
        label: "Erros",
        href: "/admin/erros",
        permission: "papel:manage",
        description: "Erros de servidor capturados",
      },
    ],
  },
];

/**
 * Item de abertura do menu — o painel certo para quem entrou.
 *
 * O `SOLICITANTE` não tem dashboard administrativo (AGENTS §7): cai no painel
 * pessoal `/meu`, que não exige permissão. Quem enxerga a rede vai para o
 * dashboard consolidado; o admin da unidade, para o dashboard da sua filial.
 */
function homeItem(
  hasPermission: (permission: string) => boolean,
  isNetworkScope: boolean,
  activeBranchId: string | null | undefined,
): NavItem {
  if (isNetworkScope && hasPermission("relatorio:read")) {
    return {
      label: "Dashboard",
      href: "/dashboard",
      description: "Indicadores de toda a rede",
    };
  }

  if (activeBranchId && hasPermission("solicitacao:approve")) {
    return {
      label: "Dashboard",
      href: `/dashboard/unidade/${activeBranchId}`,
      description: "Indicadores da sua unidade",
    };
  }

  return {
    label: "Meu painel",
    href: "/meu",
    description: "Suas solicitações e chamados",
  };
}

/**
 * Itens visíveis para o usuário, já filtrados por permissão e escopo.
 *
 * Sempre abre com o grupo **Início**; `activeBranchId` decide para onde ele
 * aponta quando o usuário não tem escopo de rede.
 *
 * `activeBranchCount` decide o que é ruído: numa instalação de uma unidade só,
 * transferência entre unidades não aparece.
 */
export function visibleNavigation(
  hasPermission: (permission: string) => boolean,
  isNetworkScope: boolean,
  activeBranchCount: number,
  activeBranchId?: string | null,
): NavGroup[] {
  const show = (item: NavItem) => {
    if (item.networkOnly && !isNetworkScope) return false;
    if (item.requiresNetwork && activeBranchCount < 2) return false;
    if (item.permission && !hasPermission(item.permission)) return false;
    return true;
  };

  const groups: NavGroup[] = [
    { label: "Início", items: [homeItem(hasPermission, isNetworkScope, activeBranchId)] },
    ...NAVIGATION,
  ];

  return groups
    .map((group) => ({ ...group, items: group.items.filter(show) }))
    .filter((group) => group.items.length > 0);
}
