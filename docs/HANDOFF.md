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

Entrega mais recente — **Login local (e-mail + senha), sem Google**:

- Nova porta de acesso: provider `local` (Credentials) + `User.passwordHash`
  (scrypt em `src/lib/password.ts`). **Não** auto-provisiona e **não** aplica a
  regra de domínio — a conta é criada por admin/seed, então aceita e-mail pessoal.
- Toggles em `/admin/configuracoes`: `auth.localLogin.enabled` e
  `auth.google.enabled` (`Config` com `type: "boolean"`). Sem `AUTH_GOOGLE_ID`,
  o Google fica desligado e o botão aparece inerte.
- Freio de força bruta em `LoginThrottle` (5 falhas → 15 min), com a decisão pura
  em `src/lib/login-throttle.ts`.
- Seed: `SEED_ADMIN_PASSWORD` grava a senha do admin; `SEED_ADMIN_RESET_PASSWORD`
  recupera o acesso. `jose-guilherme93@hotmail.com` é o admin do `.env.production`.
- Testes: `password.test.ts`, `login-throttle.test.ts`, E2E `login-local.spec.ts`.

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

Infra: **uma VPS com Dokploy** (Traefik já incluído). A aplicação é buildada pelo
`Dockerfile` (**Auto Deploy** no push da `main`); o Postgres é um serviço do próprio
Dokploy; as migrations rodam no **entrypoint** do container (1 réplica, zero-downtime
desligado). Artefatos: `Dockerfile` + `docker-entrypoint.sh` + `.dockerignore`,
`.github/workflows/backup.yml` (cópia cifrada via SSH), `src/app/api/health/route.ts`,
`.env.production.example` (checklist) e o runbook `docs/DEPLOY.md`. O portão de qualidade
é o hook `pre-push` + o CI no PR.

Fluxo: push/merge na `main` → o **Auto Deploy do Dokploy** builda e sobe → o entrypoint
espera o banco, roda `prisma migrate deploy` e depois `pnpm start`. O **seed** roda uma vez
pelo *Run Command* do Dokploy (`pnpm db:seed`). Backup: Dokploy → S3 (principal, retenção
longa) + `backup.yml` (secundária, **cifrada** com AES256, 14 dias).

Decisões registradas: o seed é **consciente do ambiente** — em `NODE_ENV=production`
cria apenas permissões, papéis, unidades, setores, configs, uma filial matriz e o admin,
**sem** empresa, filial, catálogo ou usuários de demonstração; em dev/teste cria a
demonstração completa. Divergência consciente do item da FASE 13. E2E continua local.

Pendências de produção (não bloqueiam o código): configurar o Dokploy (serviço Postgres,
S3 Destination, Application com domínio, volume `/data/uploads`, replicas=1 e env),
preencher os secrets do GitHub, apontar o DNS e testar a restauração do backup. No
primeiro deploy o acesso é pelo **login local** (sem Google).

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
- **FASE 16 — Anexos.** Compressão no cliente (WebP ≤1600px), arquivo no volume
  (`UPLOAD_DIR=/data/uploads`), `/api/anexos/[id]` com a visibilidade da demanda pai.
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

- Senha de usuário local pela administração (`/admin/usuarios`): hoje só o seed grava
  `passwordHash`. Sem uma tela para definir/trocar senha, usuários locais além do admin
  do seed não têm como entrar. `createUser` também ainda exige domínio corporativo.
- CRUD de setores na administração.
- Criar a solicitação de peça **a partir** do laudo da TI (`Request.spawnedFromDelegationId`
  já existe no schema, falta a ação/tela).
- Mostrar "veio do chamado TI-xxxx" na solicitação originada de um encaminhamento.
- Ligar chegada da peça (`WAITING_PARTS → IN_PROGRESS`) ao recebimento da solicitação.
- Anexos em object storage (Cloudflare R2) — só se um dia o volume não servir (múltiplas instâncias).
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
