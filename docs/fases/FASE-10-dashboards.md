# FASE 10 — Dashboards por perfil

> Três telas distintas: dashboard da matriz, dashboard exclusivo do admin da unidade, e home do solicitante.

## Contexto

Requisito do usuário: "existe um dashboard para o admin da matriz, e um dashboard só para
o admin de cada unidade". Além disso, "as solicitações emitem notificação no dashboard da
pessoa responsável por responder aos chamados" — ou seja, o dashboard da unidade é a mesa
de trabalho de quem aprova.

As três telas **não podem misturar audiência** (ver `AGENTS.md` §7).

## Pré-requisitos

- FASE 09 concluída (notificações e alertas).
- FASE 06, 07, 08 concluídas (todas as agregações existem).

## Tarefas

### 10.1 — Camada de agregação

`src/server/services/dashboard/` — **uma função por indicador, sem duplicar cálculo**:

- [ ] `stock.ts` — `stockValue(ctx, filter?)`, `countBelowMinimum(ctx)`,
      `itemsBelowMinimum(ctx, limit)`, `movementTotals(ctx, from, to)`,
      `stockByCategory(ctx)`, `topConsumedItems(ctx, from, to, limit)`.
- [ ] `request.ts` — `requestsByStatus(ctx)`, `pendingRequests(ctx)`,
      `averageApprovalHours(ctx)`, `oldestPendingRequest(ctx)`, `deliveriesInPeriod(ctx)`.
- [ ] `transfer.ts` — `inTransitByBranch(ctx)`, `incomingFor(ctx, branchId)`.
- [ ] `branch.ts` — `branchKpis(ctx, branchId)`, `allBranchKpis(ctx)`.
- [ ] `index.ts` — `getMatrixDashboard(ctx)` e `getUnitDashboard(ctx, branchId)`
      orquestrando os indicadores acima.
- [ ] Todas as funções recebem `ctx` e aplicam `branchFilter` internamente.
- [ ] Usar agregações do Prisma (`groupBy`, `_sum`, `_count`) — **nada de N+1** em dashboard.
- [ ] Marcar cada função com `scope: "ALL_BRANCHES" | "OWN_BRANCHES"`.

### 10.2 — Dashboard da matriz

`src/app/(app)/dashboard/page.tsx` — guard `requireAnyPermission(["relatorio:read"])` +
`requireNetworkScope()`.

- [ ] Cards: valor total de estoque; itens abaixo do mínimo (rede); solicitações
      pendentes; idade média de aprovação; transferências em trânsito; movimentações do mês.
- [ ] Gráficos:
  - [ ] Entradas × saídas por semana (últimos 90 dias) — `AreaChart` empilhado.
  - [ ] Valor de estoque por filial — `BarChart` horizontal, ordenável.
  - [ ] Solicitações por status — `BarChart` ou donut.
  - [ ] Top 10 itens por consumo no mês — `BarChart` horizontal.
- [ ] Tabela "Pendências por filial": filial, aguardando aprovação, SLA em risco,
      itens no mínimo, transferências a receber, link para a unidade.
- [ ] Tudo com filtro de período na URL e efeito de "carregando" sem layout shift.
- [ ] Se o usuário não tiver escopo de rede → redirect para `/meu` com aviso.

### 10.3 — Dashboard da unidade

`src/app/(app)/dashboard/unidade/[branchId]/page.tsx` —
**exclusivo do admin da unidade** (e da matriz em leitura):

- [ ] Guard: `requirePermission("solicitacao:approve")` **e**
      `requireBranch(branchId)`; `ADMIN_FILIAL` só acessa a própria filial.
- [ ] **Topo: alertas de chamados** — o bloco mais visível da tela:
  - [ ] Solicitações aguardando resposta (com tempo aberto e destaque de SLA em risco).
  - [ ] Itens abaixo do mínimo.
  - [ ] Entregas pendentes.
  - [ ] Transferências a receber.
  - [ ] Sino de não lidas, integrado ao mesmo layout do `AGENTS.md` §7.
- [ ] Fila de aprovação resumida (top 5) com link para `/solicitacoes/fila`.
- [ ] Aguardando separação.
- [ ] Indicadores da filial: saldo por categoria, itens no mínimo, consumo do mês.
- [ ] Botão "Nova solicitação" disponível (o admin também solicita).
- [ ] Link para o relatório completo da filial.
- [ ] `ADMIN_FILIAL` que tentar acessar outra filial recebe 403 (não redirect silencioso).

### 10.4 — Visão de unidades (matriz)

`src/app/(app)/dashboard/unidades/page.tsx`:

- [ ] Tabela com uma linha por filial ativa: código, nome, cidade/UF, responsável,
      pendências, valor de estoque, % de itens no mínimo, última movimentação.
- [ ] Ordenação e busca na URL; clique na linha leva ao dashboard da unidade.
- [ ] Filtro "somente com pendências".

### 10.5 — Home do solicitante

`src/app/(app)/meu/page.tsx` — para qualquer usuário logado:

- [ ] Minhas solicitações recentes com status (badge) e atalho para `/solicitacoes/nova`.
- [ ] Minhas últimas entregas (comprovantes).
- [ ] Notificações não lidas resumidas.
- [ ] **Sem** nenhum dado de gestão: sem estoque, sem outros solicitantes.

### 10.6 — Navegação por perfil

- [ ] `src/lib/navigation.ts` — menu lateral montado por permissão do `ctx`:
  cada item tem `permission` e `href`. Usuário sem permissão **não vê** o item.
- [ ] Itens condicionais: `Dashboard` (só rede), `Minha unidade` (admin de filial),
    `Solicitações`, `Estoque`, `Transferências`, `Inventário`, `Catálogo`,
    `Filiais`, `Relatórios`, `Administração`.
- [ ] Redirecionamento pós-login por perfil:
  - rede → `/dashboard`
  - admin de filial → `/dashboard/unidade/<sua filial>`
  - demais → `/meu`
- [ ] Breadcrumb em toda página.

### 10.7 — Componentes de dashboard

`src/components/dashboard/`:

- [ ] `metric-card.tsx` — título, valor, variação, link, estado de carregamento.
- [ ] `chart-card.tsx` — wrapper com título, período e estado vazio.
- [ ] `stock-semaforo.tsx` — badge verde/amarelo/vermelho conforme mínimo.
- [ ] `status-badge.tsx` — badge padronizado por status (solicitação, transferência,
    documento, inventário). **Um único lugar** definindo cores de status.
- [ ] `pending-requests-panel.tsx` — o painel de chamados do dashboard da unidade.
- [ ] Skeletons que não quebram o layout.

## Testes obrigatórios

`__tests__/dashboard-scope.test.ts`:

- [ ] `getMatrixDashboard` de um `ADMIN_FILIAL` lança `ForbiddenError`.
- [ ] `getUnitDashboard` com `branchId` fora de `branchIds` lança `ForbiddenError`.
- [ ] `getUnitDashboard` de rede soma corretamente as filiais.
- [ ] Valores de `stockValue` batem com a soma manual dos `StockLevel`.

`e2e/dashboards.spec.ts`:

- [ ] `ADMIN_MATRIZ` vê `/dashboard` com dados de todas as filiais.
- [ ] `ADMIN_FILIAL` **não** acessa `/dashboard` (redirecionado) e **não** acessa
      `/dashboard/unidade/<outra filial>` (403).
- [ ] `SOLICITANTE` é levado para `/meu` e não vê itens de menu administrativos.
- [ ] Após enviar uma solicitação, o dashboard do `ADMIN_FILIAL` mostra o novo chamado.

## Critérios de aceite

- [ ] Admin da matriz enxerga todas as filiais; admin de filial **só** a sua;
      solicitante não enxerga dashboard de gestão.
- [ ] Contador do painel de chamados == contador do sino de notificações.
- [ ] Dashboard carrega sem N+1 (verificar com log de queries do Prisma; meta: < 20 queries).
- [ ] Filtro de período na URL recarrega o dashboard corretamente.
- [ ] Estados vazios com texto útil (ex.: "nenhuma solicitação aguardando resposta").
- [ ] Layout não quebra em tela de 390px de largura.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passam.

## Fora do escopo

Comparativo temporal com foto, metas por filial, exportação para BI, dashboards
configuráveis pelo usuário.
