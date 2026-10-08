import type { TestUserKey } from "./auth";

/**
 * As telas da aplicação, num lugar só.
 *
 * Existe por causa de um custo concreto: cada rota em `next dev` é compilada **na
 * primeira visita**. Com ~35 telas, essa compilação acontece no meio dos testes —
 * dentro do `expect.timeout` de 15s — e vira falha por lentidão que não é defeito
 * de ninguém. Foi o que fez a suíte não fechar em 25 minutos no CI, com retry
 * dobrando cada falso negativo.
 *
 * Então esta lista serve a dois consumidores: o warm-up (`global-setup.ts`) usa os
 * caminhos para compilar tudo antes do primeiro teste, e `mobile.spec.ts` usa o
 * perfil e o rótulo para medir a largura de cada tela. Duas listas divergiriam, e a
 * divergência apareceria como teste lento que ninguém sabe explicar.
 */
export type AppRoute = {
  path: string;
  user: TestUserKey;
  label: string;
};

export const APP_ROUTES: AppRoute[] = [
  { user: "superAdmin", path: "/dashboard", label: "Dashboard da matriz" },
  { user: "superAdmin", path: "/dashboard/unidades", label: "Visão por unidade" },
  { user: "superAdmin", path: "/admin/usuarios", label: "Usuários" },
  { user: "superAdmin", path: "/admin/usuarios/novo", label: "Novo usuário" },
  { user: "superAdmin", path: "/admin/papeis", label: "Papéis" },
  { user: "superAdmin", path: "/admin/auditoria", label: "Auditoria" },
  { user: "superAdmin", path: "/admin/erros", label: "Erros do servidor" },
  { user: "superAdmin", path: "/admin/politicas-email", label: "Políticas de e-mail" },
  { user: "superAdmin", path: "/admin/politicas-email/nova", label: "Nova política de e-mail" },
  { user: "superAdmin", path: "/filiais", label: "Unidades" },
  { user: "superAdmin", path: "/filiais/nova", label: "Nova unidade" },
  { user: "superAdmin", path: "/catalogo/itens", label: "Materiais" },
  { user: "superAdmin", path: "/relatorios", label: "Relatórios" },
  { user: "superAdmin", path: "/relatorios/consolidados", label: "Relatórios consolidados" },
  { user: "adminFilial", path: "/dashboard/unidade/x", label: "Dashboard da unidade" },
  { user: "adminFilial", path: "/solicitacoes/fila", label: "Fila de aprovação" },
  { user: "adminFilial", path: "/entregas", label: "Entregas" },
  { user: "almoxarife", path: "/estoque/saldos", label: "Saldos" },
  { user: "almoxarife", path: "/estoque/movimentacoes", label: "Movimentações" },
  { user: "almoxarife", path: "/estoque/entradas/nova", label: "Nova entrada" },
  { user: "almoxarife", path: "/estoque/ajustes/novo", label: "Novo ajuste" },
  { user: "almoxarife", path: "/inventario", label: "Inventário" },
  { user: "almoxarife", path: "/inventario/nova", label: "Novo inventário" },
  { user: "almoxarife", path: "/transferencias", label: "Transferências" },
  { user: "almoxarife", path: "/transferencias/nova", label: "Nova transferência" },
  { user: "almoxarife", path: "/reparos", label: "Chamados de reparo" },
  { user: "solicitante", path: "/solicitar", label: "Escolha do pedido" },
  { user: "solicitante", path: "/solicitacoes/nova", label: "Solicitar material" },
  { user: "solicitante", path: "/reparos/novo", label: "Abrir reparo" },
  { user: "solicitante", path: "/solicitacoes", label: "Minhas solicitações" },
  { user: "solicitante", path: "/meu", label: "Meu painel" },
  { user: "solicitante", path: "/notificacoes", label: "Notificações" },
];

/**
 * Rotas que existem só para provar o caminho de erro.
 *
 * Ficam fora de `APP_ROUTES` porque não são telas: não têm perfil nem precisam
 * de warm-up (a página de erro é uma só e já é compilada pelos testes).
 */
export const ERROR_ROUTES = ["/rota-que-nao-existe", "/acesso-negado"] as const;
