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
  { user: "superAdmin", path: "/patrimonio", label: "Patrimônio" },
  { user: "superAdmin", path: "/relatorios", label: "Relatórios" },
  { user: "superAdmin", path: "/relatorios/consolidados", label: "Relatórios consolidados" },
  // `x` não é uma unidade real: esta linha mede a tela de **não encontrado**.
  // O nome antigo ("Dashboard da unidade") descrevia outra tela, e foi ela que
  // apareceu como flaky — medir uma página que a pessoa quase nunca vê e chamá-la
  // de dashboard é o tipo de teste que passa sem provar nada.
  { user: "adminFilial", path: "/dashboard/unidade/x", label: "Unidade inexistente" },
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
 * Ficam fora de `APP_ROUTES` porque não são telas de trabalho: não têm perfil e
 * não precisam do rótulo de responsividade. Mas **precisam** de warm-up — o
 * `/forbidden` era compilado frio dentro do `expect.timeout` do primeiro teste
 * que o visitava, e é uma das telas que apareciam como flaky.
 */
export const ERROR_ROUTES = ["/forbidden", "/acesso-negado", "/rota-que-nao-existe"] as const;

/**
 * Rotas de **detalhe**, que só existem com um id.
 *
 * O warm-up não pode inventar um id: uma página que não encontra o registro
 * lança, o funil de erro grava a linha, e `erros.spec.ts` — que afirma
 * "Nenhum erro registrado" — quebraria por causa do aquecimento. Então o id é
 * **extraído da listagem real** (uma requisição a mais, sem renderização) e o
 * detalhe é aquecido com dado de verdade.
 *
 * Se a listagem vier vazia (banco recém-semeado), a rota é simplesmente pulada:
 * aquecer é otimização, e pular não pode virar falha.
 */
export const DETAIL_LISTS: Array<{ list: string; pattern: RegExp }> = [
  { list: "/filiais", pattern: /\/filiais\/([A-Za-z0-9]{10,})/ },
  { list: "/solicitacoes", pattern: /\/solicitacoes\/([A-Za-z0-9]{10,})/ },
  { list: "/reparos", pattern: /\/reparos\/([A-Za-z0-9]{10,})/ },
  { list: "/inventario", pattern: /\/inventario\/([A-Za-z0-9]{10,})/ },
  { list: "/transferencias", pattern: /\/transferencias\/([A-Za-z0-9]{10,})/ },
  { list: "/estoque/movimentacoes", pattern: /\/estoque\/movimentacoes\/([A-Za-z0-9]{10,})/ },
  { list: "/relatorios/consolidados", pattern: /\/relatorios\/consolidados\/([A-Za-z0-9]{10,})/ },
  { list: "/admin/usuarios", pattern: /\/admin\/usuarios\/([A-Za-z0-9]{10,})/ },
  { list: "/catalogo/itens", pattern: /\/catalogo\/itens\/([A-Za-z0-9]{10,})/ },
  { list: "/patrimonio", pattern: /\/patrimonio\/([A-Za-z0-9]{10,})/ },
];
