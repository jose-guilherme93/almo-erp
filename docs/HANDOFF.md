# Handoff — estado do trabalho

> Última atualização: 2026-09-29. Leia isto antes de retomar; evita redescobrir o contexto.

## Onde estamos

- Branch de trabalho: **`develop`** (remota `origin/develop`).
- **`main` intocada** (`88e099a`). Não fazemos push na `main`.
- Não há PR aberto. O PR #1 foi fechado e a branch `feat/fases-14-18-setores-delegacao`
  foi removida (os commits já estão todos na `develop`).
- Só existem `develop` e `main` no remoto.

## O que está pronto e verde

Gates rodados na `develop`: `pnpm lint`, `pnpm typecheck`, `pnpm test` (330), `pnpm build`,
`pnpm db:seed`. O CI do GitHub rodou o mesmo pipeline: **sucesso em 2m43s**.

Entrega mais recente — **Onda 1 de integridade** (plano em `docs`/handoff; ver abaixo):

- **Busca não vaza escopo de filial.** `listRequests` e `listMaintenanceRequests` combinam
  escopo e busca com `AND` (antes o `OR` da busca sobrescrevia o da visibilidade).
- **Lock pessimista** em reserva (`lockItemLevels`/`lockStockLevelById`), transferência e
  inventário (`lockFlowRow`), com testes de concorrência. `CHECK` de saldo/reserva no banco.
- **Entrega multi-local**: um `ISSUE` por prateleira; **lote** na reserva (FEFO pelo ledger),
  em `TransferLine` e no ajuste de inventário.
- **Cancelamento de documento vinculado** (`REQUEST`/`TRANSFER`/`INVENTORY`) bloqueado.
- Transição de recebimento de transferência passa pela máquina; atribuição de chamado idem.

Entregue antes:

- **FASE 14 — Setores e encaminhamento.** `Sector`, `Membership.sectorId`,
  `sectorId`/`serviceSectorId` em `Request`/`MaintenanceRequest`; `Delegation` +
  `DelegationEvent` (almoxarifado encaminha etapa → setor responde com laudo → comando
  volta à origem). Visibilidade: solicitante só vê o próprio; setor de serviço só vê o
  que foi encaminhado a ele; `solicitacao:overview`/`manutencao:overview` = escopo.
- **FASE 15 — Mobile do solicitante.** `/solicitar` com 3 botões (material, reparo, TI),
  defaults preenchidos, `/meu` enxuto.
- **FASE 16 — Anexos.** Compressão no cliente (WebP ≤1600px), arquivo em disco,
  `/api/anexos/[id]` com a visibilidade da demanda pai.
- **FASE 17 — TI e peças.** Categoria `IT` roteia para a TI; `/encaminhamentos` com laudo.
- **FASE 18 — Relatórios.** "Demanda por setor" e "Duração das demandas".
- **Correções:** super admin/matriz enxergam e são notificados dos pedidos das unidades;
  todo indicador do dashboard abre a lista equivalente (`?filial=`, `?emTransito=1`,
  `?relatorio=`); teste `dashboard.test.ts` prova contagem × lista.
- **CI:** `.github/workflows/ci.yml` só dispara em `main`, com `timeout-minutes: 5`;
  e2e virou manual (`e2e.yml`, `workflow_dispatch`, teto de 5 min). Regra em `AGENTS.md §9.1`.

## Comandos de verificação

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm db:seed
```

## Pendências conhecidas (escopo, não bug)

- CRUD de setores na administração; editar setor do vínculo na tela de usuário.
- Criar a solicitação de peça **a partir** do laudo da TI (`Request.spawnedFromDelegationId`
  já existe no schema, falta a ação/tela).
- Mostrar "veio do chamado TI-xxxx" na solicitação originada de um encaminhamento.
- Ligar chegada da peça (`WAITING_PARTS → IN_PROGRESS`) ao recebimento da solicitação.
- Upload de foto avulsa no detalhe (a ação `anexarImagemAction` existe; falta o componente).
- Volume compartilhado de uploads para múltiplas instâncias (`UPLOAD_DIR`).
- Gráfico de evolução mensal na tela de relatórios.

## Aviso não bloqueante

- O `pnpm build` emite um aviso do Turbopack sobre acesso dinâmico ao diretório de uploads
  (tracing). Não quebra o build.

## Mapa rápido

- Setores: `src/server/services/sector/`.
- Encaminhamento: `src/server/services/delegation/` + `src/server/actions/delegacao.ts` +
  `/encaminhamentos`.
- Anexos: `src/server/services/attachment/`, `src/lib/image-compression.ts`,
  `src/app/api/anexos/[id]/route.ts`.
- Relatórios: `src/server/services/reports/index.ts`.
- Visibilidade/escopo: `src/server/auth/scope.ts`, filtros em `request/` e `maintenance/`.
- Permissões: `src/lib/permissions/catalog.ts` + `matrix.ts` (papel `TI` incluído).
- Dashboards: `src/server/services/dashboard/index.ts` + páginas em `src/app/(app)/dashboard/`.

## Decisões de domínio que não podem ser quebradas

- Saldo negativo é proibido; estoque só muda por `StockDocument` em transação (AGENTS §3.3).
- Status muda só por função de transição (AGENTS §3.4).
- Autorização no servidor; toda query de negócio filtrada por escopo (AGENTS §3.1/§3.2).
- Urgência é de quem recebe; unidade é de quem pede; criar já é enviar (AGENTS §3.7/§3.8).
