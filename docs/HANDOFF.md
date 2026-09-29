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

Entrega mais recente — **Exportação de relatórios (PDF + Google Drive) com auditoria**:

- **Snapshot imutável**: consolidar grava `ReportSnapshot` (dados, filtro, autor,
  hash SHA-256). Trigger no banco recusa `UPDATE`/`DELETE`; a tela reconstrói do
  snapshot, nunca reconsulta.
- **Registro de exportação**: `ReportExport` (CSV/PRINT/DRIVE, destino, data) +
  `AuditLog`. Histórico em `/relatorios/consolidados`.
- **PDF** via impressão do navegador; **Google Drive** via Google Identity
  Services com escopo mínimo `drive.file` (sem token no servidor). Requer
  `NEXT_PUBLIC_GOOGLE_CLIENT_ID` + Drive API/escopo no Google Cloud Console —
  sem isso o botão fica desabilitado (pré-requisito não configurado ainda).
- Testes: `report-snapshot.test.ts` (imutabilidade no banco, hash, auditoria,
  escopo), `drive.test.ts` (multipart/nome), E2E `relatorios.spec.ts`.

Entrega mais recente — **Fluxo de atendimento de chamados (TI/Manutenção)**:

- **Setor no vínculo**: `Membership.sectorId` editável na administração (criar
  usuário, adicionar e editar vínculo). É o que liga a pessoa ao setor de
  atendimento.
- **Visibilidade por setor de atendimento**: quem não tem `*:overview` enxerga o
  chamado/solicitação roteado ao seu setor (`serviceSectorId`) dentro das filiais
  a que tem acesso — antes disso um chamado de TI era invisível para o técnico
  até ser atribuído.
- **Fan-out por setor**: `MAINTENANCE_CREATED` vai para o setor de atendimento da
  filial (+ rede + responsável), com fallback para `manutencao:atender`; as
  notificações de encaminhamento passaram a filtrar por filial.
- **Home de quem atende**: técnico de TI cai em `/reparos`, com abertos por padrão
  e alternância para concluídos.
- **Dados**: `ti@batistaonline.com.br` (FILIAL-3) com setor TI. Obs.: o seed de
  demonstração também vincula esse e-mail a **FIL-SP** (setor TI); rodar
  `pnpm db:seed` recria esse vínculo. Remova-o ou ajuste o seed se o técnico
  deve atender só João Paulo.

Entrega mais recente — **Onda 1 de integridade** (plano em `docs`/handoff; ver abaixo):

- **Busca não vaza escopo de filial.** `listRequests` e `listMaintenanceRequests` combinam
  escopo e busca com `AND` (antes o `OR` da busca sobrescrevia o da visibilidade).
- **Lock pessimista** em reserva (`lockItemLevels`/`lockStockLevelById`), transferência e
  inventário (`lockFlowRow`), com testes de concorrência. `CHECK` de saldo/reserva no banco.
- **Entrega multi-local**: um `ISSUE` por prateleira; **lote** na reserva (FEFO pelo ledger),
  em `TransferLine` e no ajuste de inventário.
- **Cancelamento de documento vinculado** (`REQUEST`/`TRANSFER`/`INVENTORY`) bloqueado.
- Transição de recebimento de transferência passa pela máquina; atribuição de chamado idem.
- **Bugs achados pelo E2E (corrigidos):** `buscarItensAction`/`buscarPorCodigoBarrasAction`
  exigiam `item:read`, que o `SOLICITANTE` não tem — o fluxo central de pedido era impossível
  pela interface; e `RequestForm`/`StockDocumentForm` disparavam ação dentro do updater do
  `setLines` (setState durante render).
- **E2E dos fluxos críticos:** `e2e/solicitacoes.spec.ts` (pedido → aprovação → entrega),
  `e2e/estoque.spec.ts` (entrada, ajuste, transferência enviar/receber) e
  `e2e/inventario.spec.ts` (contar → encerrar → ajustar). Suíte chromium: **80/80**.

## Deploy

Infra definida: **VPS única com Docker** (app + Postgres + Caddy). Artefatos criados:
`Dockerfile`, `.dockerignore`, `docker-compose.prod.yml`, `Caddyfile`,
`scripts/backup-db.sh`, `src/app/api/health/route.ts` (fora do gate do `proxy.ts`) e o
runbook `docs/DEPLOY.md`. Sem `output: standalone` (runtime é `pnpm start`).

Decisões registradas: app e banco no mesmo host (ponto único de falha mitigado por
backup offsite); seed roda **uma vez** em produção como bootstrap (pula usuários de demo),
divergindo conscientemente do item da FASE 13; E2E continua local.

Pendências de produção (não bloqueiam o código): provisionar o host, DNS, credencial
OAuth de produção, `AUTH_SECRET` novo, agendar o backup e testar a restauração.

## E2E — como rodar

O E2E é **local-first** (AGENTS §9.1). O bypass de autenticação de teste só existe fora de
produção, então o servidor é o `pnpm dev` (padrão do `playwright.config.ts`):

```bash
E2E_AUTH_BYPASS=true pnpm e2e --project=chromium
```

- Se já houver um `pnpm dev` na 3000, o Playwright o reutiliza. **Importante:** depois de
  alterar `prisma/schema.prisma`, reinicie o `pnpm dev` — ele mantém o Prisma Client antigo
  em memória e o E2E falha com `Unknown argument`.
- `pnpm build && pnpm start` **não** serve para E2E (o `env.ts` recusa o bypass em produção).
- O `e2e.yml` do Actions é manual/opcional, capado em 5 min; não transformar em job longo.

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

- CRUD de setores na administração.
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
