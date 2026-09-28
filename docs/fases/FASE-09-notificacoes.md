# FASE 09 — Notificações e caixa de entrada

> Notificação de solicitação aparece no dashboard de quem responde pelo chamado.

## Contexto

Requisito explícito do usuário: "as solicitações de materiais emitem notificação no
dashboard da pessoa responsável por responder aos chamados". Aqui a notificação deixa de
ser um gancho registrado e vira o sistema real: persistida no banco, com sino, caixa de
entrada e fan-out testado.

## Pré-requisitos

- FASE 08 e FASE 07 concluídas (os eventos que geram notificação existem).
- FASE 01: `Notification` e `Config` existentes.

## Tarefas

### 09.1 — Motor de notificação

`src/server/services/notificacao/`:

- [ ] `types.ts` — mapa `NotificationType → { title: (ctx) => string; body: (ctx) => string; link: (ctx) => string }`.
  Textos em **pt-BR**, com o número da solicitação/movimento e o nome do solicitante,
  escritos para o aprovador decidir rápido.
- [ ] `resolve-recipients.ts` — **arquivo único** com a regra de fan-out de
  `ARQUITETURA.md` §7. Um switch por tipo, nenhum outro lugar resolve destinatário.
  - [ ] Helper `usersWithPermission(branchId, permission)` reutilizando `scope`.
  - [ ] Sempre excluir o `actorId` do resultado.
  - [ ] Deduplicar destinatários e ordenar por id (determinismo em teste).
- [ ] `notify.ts` — `notify(tx, { type, actorId, branchId, entityType, entityId, payload })`:
  - [ ] **Recebe o `tx`** para ser chamado dentro da transação do evento.
  - [ ] Resolve destinatários, monta título/corpo/link e faz `createMany`.
  - [ ] Idempotente por `(userId, type, entityId)` quando `dedupe = true`
      (usado por `STOCK_BELOW_MIN` e `INVENTORY_DIVERGENCE`).
- [ ] `mark-as-read.ts` — `markRead(userId, notificationId)`, `markAllRead(userId)`,
      `markReadOnOpen(entityType, entityId, userId)`. Idempotentes e com escopo de usuário
      (um usuário **nunca** marca notificação de outro).
- [ ] `unread-count.ts` — **função única** que devolve as contagens por tipo.
  Consumida pelo sino e pelo dashboard (regra do `AGENTS.md` §7).
- [ ] `cleanup.ts` — rotina de limpeza de notificações lidas com mais de 90 dias
      (chamada por script, não por request).

### 09.2 — Ligar os eventos

Chamar `notify(tx, ...)` **dentro da transação existente** em:

- [ ] `request/submit.ts` → `REQUEST_CREATED` (para `defaultApproverId` + todos com
      `solicitacao:approve` na filial).
- [ ] `request/claim.ts` → `REQUEST_CLAIMED` (para os demais aprovadores da fila).
- [ ] `request/approve.ts` → `REQUEST_APPROVED` e `REQUEST_PARTIALLY_APPROVED` (solicitante).
- [ ] `request/reject.ts` → `REQUEST_REJECTED` (solicitante, com motivo no corpo).
- [ ] `request/deliver.ts` → `REQUEST_DELIVERED` (solicitante + responsável).
- [ ] `transfer/send.ts` → `TRANSFER_SENT` (receptores do destino).
- [ ] `transfer/receive.ts` → `TRANSFER_RECEIVED` (almoxarife e matriz da origem).
- [ ] `stock/post-document.ts` → `STOCK_BELOW_MIN` quando cruzar o mínimo, deduplicado por
      `Config.stock.belowMinDedupDays`.
- [ ] `inventory/close.ts` → `INVENTORY_DIVERGENCE`.
- [ ] `usuario/grant.ts` → `ACCESS_GRANTED`.

### 09.3 — Sino e caixa de entrada

- [ ] `src/components/layout/notification-bell.tsx` (client):
  - [ ] Badge com `unreadCount` vindo do servidor (Server Component pai passa a prop).
  - [ ] Popover com as 5 mais recentes, com link direto.
  - [ ] Refetch por `revalidateTag("notifications")` — **sem polling agressivo**.
- [ ] `src/components/layout/topbar.tsx` — integrar o sino.
- [ ] `src/app/(app)/notificacoes/page.tsx`:
  - [ ] Lista paginada, mais recentes primeiro, com separador "não lidas".
  - [ ] Filtro por tipo e por "somente não lidas" (na URL).
  - [ ] Ao clicar, marca como lida e navega para o `link` (deep link).
  - [ ] Botão "marcar todas como lidas".
  - [ ] Estado vazio com texto útil ("nenhuma notificação nova").
- [ ] `src/app/(app)/notificacoes/[id]/page.tsx` ou action `abrirNotificacao` que
      marca como lida e faz redirect para o destino.
- [ ] `loading.tsx` e `error.tsx`.

### 09.4 — Alerta no dashboard de quem responde

- [ ] Serviço `src/server/services/dashboard/alerts.ts` com **uma função por perfil**,
  consumida na FASE 10 e já pronta aqui:
  - [ ] `alertsForBranchAdmin(branchId)` → { solicitações aguardando resposta,
        não lidas, itens abaixo do mínimo, entregas pendentes, transferências a receber }.
  - [ ] `alertsForMatrixAdmin()` → { rede: pendências por filial, em trânsito, SLA em risco }.
- [ ] Requisito do AGENTS.md §7: **contadores do dashboard e do sino vêm da mesma função**.
  Implementar `unreadCount` e reutilizá-la nos dois lugares, e adicionar teste de
  consistência entre os dois números.

## Testes obrigatórios

`__tests__/resolve-recipients.test.ts`:

- [ ] `REQUEST_CREATED` notifica `defaultApproverId` + todos com `solicitacao:approve`.
- [ ] O autor da solicitação não é notificado.
- [ ] Usuário de outra filial **nunca** é notificado.
- [ ] `TRANSFER_SENT` notifica o destino, não a origem.
- [ ] Sem aprovador na filial → lista vazia sem erro.

`__tests__/notify.test.ts`:

- [ ] `notify` dentro de transação que falha **não** deixa notificação órfã
      (teste de rollback).
- [ ] `STOCK_BELOW_MIN` deduplica dentro da janela de dias.
- [ ] `markRead` de notificação de outro usuário é rejeitado.

`e2e/notificacoes.spec.ts`:

- [ ] Solicitante envia → aprovador vê o sino com contador > 0.
- [ ] Aprovar → sino do solicitante mostra "aprovada".
- [ ] Marcar todas como lidas zera o badge.

## Critérios de aceite

- [ ] Solicitação enviada aparece como notificação para o `ADMIN_FILIAL` em menos de
      1 segundo após o envio (mesma transação).
- [ ] Aproximadamente **zero** chamadas de API repetidas para o sino (sem polling).
- [ ] Nenhuma notificação é entregue para usuário de outra filial.
- [ ] Contador do sino e do dashboard mostram **o mesmo número** (teste de consistência).
- [ ] Falha na transação do evento não gera notificação fantasma.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passam.

## Fora do escopo

E-mail, SMS, push do navegador, WebSocket em tempo real, grouping/digest diário.
