# FASE 08 — Solicitações de materiais

> Tela de solicitação para qualquer usuário logado, aprovação na unidade, e entrega com baixa de estoque.

## Contexto

O pedido do usuário: "existe uma tela pra qualquer usuario logado solicitar materiais".
E o fluxo: solicitante → aprovação da filial → entrega. Esta fase implementa o ciclo
completo, incluindo **reserva de saldo na aprovação** e **baixa automática na entrega**.

## Pré-requisitos

- FASE 06 (reservas e motor de movimentação) e FASE 07 (transferências) concluídas.
- FASE 01: `Request`, `RequestLine`, `RequestEvent`, `Delivery` existentes.

## Máquina de estados

```
DRAFT ──enviar──▶ SUBMITTED ──assumir──▶ IN_REVIEW
                        │  (sem claim: fica na fila da filial)
                        │
   ┌────────────────────┴───────────────────┐
   ▼                                        ▼
APPROVED / PARTIALLY_APPROVED           REJECTED (fim)
   │
   ├──separar──▶ IN_PREPARATION
   └──entregar─▶ DELIVERED
```

## Tarefas

### 08.1 — Service de solicitação

`src/server/services/request/`:

- [ ] `create.ts` — cria `DRAFT` + linhas. Calcula `availabilityStatus` por linha
      (`AVAILABLE` / `PARTIAL` / `UNAVAILABLE`) consultando saldo **da filial solicitante**,
      sem bloquear o pedido.
- [ ] `submit.ts`:
  - [ ] Define `responsibleId` = `Branch.defaultApproverId` (ou o primeiro aprovador da filial).
  - [ ] Grava `RequestEvent` `CREATED` e `SUBMITTED`.
  - [ ] Deixa o gancho de notificação `REQUEST_CREATED` (disparo na FASE 09).
- [ ] `claim.ts` — ao abrir para decidir, seta `claimedById`/`claimedAt`.
  - [ ] Se outro usuário já assumiu, mostrar "em análise por <nome>" e bloquear a decisão.
- [ ] `approve.ts`:
  - [ ] Valida transições; exige claimed-by ou ser o `responsibleId`.
  - [ ] Grava `approvedQuantity` por linha (≤ `requestedQuantity`).
  - [ ] Se qualquer linha ficar abaixo do pedido → `PARTIALLY_APPROVED` e **exige**
        `nonApprovalReason` por linha não aprovada integralmente.
  - [ ] **Cria `StockReservation` para cada linha aprovada** (FASE 06).
  - [ ] Grava `decidedById`, `decidedAt`, `RequestEvent`.
- [ ] `reject.ts` — exige `rejectionReason`; libera reservas (nenhuma a criar);
  grava `RequestEvent`.
- [ ] `start-preparation.ts` — `IN_PREPARATION` (almoxarife separando).
- [ ] `deliver.ts`:
  - [ ] Grava `deliveredQuantity` por linha (≤ `approvedQuantity`).
  - [ ] Cria **um** `StockDocument` `ISSUE` com a baixa.
  - [ ] Consome as reservas; se entregar menos que o aprovado, libera a diferença.
  - [ ] Cria `Delivery` com `receivedByName`, `receivedByDocument`, `deliveredAt`.
  - [ ] Grava `RequestEvent` `DELIVERED`.
- [ ] `cancel.ts` — só em `DRAFT`/`SUBMITTED`; libera reservas; o solicitante cancela.
- [ ] `transitions.ts` — tabela de transições válidas.
- [ ] `numbering.ts` — `SOL-2026-000045` por filial.
- [ ] `sla.ts` — `hoursSince(submittedAt)` comparado com `Config.sla.approvalHours`
      para marcar "SLA em risco" na fila.

### 08.2 — Ações

- [ ] `src/server/actions/request.ts` — `criarSolicitacao`, `atualizarRascunho`,
      `enviarSolicitacao`, `assumirSolicitacao`, `aprovarSolicitacao`,
      `rejeitarSolicitacao`, `iniciarSeparacao`, `registrarEntrega`, `cancelarSolicitacao`.
- [ ] Padrão obrigatório em cada uma:
  `Zod` → `requirePermission(...)` → `requireBranch(request.branchId)` → service →
  `AuditLog` → `revalidatePath` → `ActionResult`.
- [ ] `aprovarSolicitacao` exige `solicitacao:approve` **e** a ação vem de um servidor —
  nunca confiar em quantidade aprovada vinda do cliente sem revalidar contra a solicitação.

### 08.3 — Tela: qualquer usuário solicita

`src/app/(app)/solicitacoes/nova/page.tsx` — **acesso de qualquer usuário logado com membership**:

- [ ] Formulário em duas etapas na mesma página (itens + revisão).
- [ ] Cabeçalho: prioridade (`NORMAL` como padrão, com tooltip explicando cada nível),
      data de necessidade, observação.
- [ ] Tabela de itens: `ItemCombobox` + scanner, quantidade, **disponibilidade exibida
      em tempo real** ("12 disponíveis"), custo estimado, remover linha.
- [ ] Resumo: total de itens, valor estimado, botão "salvar rascunho" e "enviar solicitação".
- [ ] Sem JavaScript de cliente desnecessário: a disponibilidade vem de uma Server
      Action `checkAvailability` disparada ao adicionar item.
- [ ] Rascunho fica editável em `/solicitacoes/[id]` enquanto `DRAFT`.

### 08.4 — Minhas solicitações

- [ ] `src/app/(app)/solicitacoes/page.tsx` — "Minhas solicitações":
      filtros por status, período, busca; colunas: número, data, itens, prioridade,
      status (badge), valor, ações.
- [ ] `src/app/(app)/solicitacoes/[id]/page.tsx`:
  - [ ] Resumo do pedido + tabela de linhas com solicitado/aprovado/entregue.
  - [ ] **Timeline de eventos** (`RequestEvent`) em formato de histórico legível,
        mostrando quem e quando — para o solicitante entender o que está acontecendo.
  - [ ] Para aprovadores: card de decisão (aprovar tudo / aprovar parcial / rejeitar).
  - [ ] Para almoxarife: card de separação e de entrega.
  - [ ] Autorização de leitura: dono, aprovadores da filial, matriz. Caso contrário, 403.
- [ ] Botão de cancelamento para o solicitante quando permitido.
- [ ] Impressão/visualização de comprovante de entrega (comprovante simples em HTML
      pronto para imprimir; PDF é da FASE 13).

### 08.5 — Fila de aprovação

- [ ] `src/app/(app)/solicitacoes/fila/page.tsx` — fila da filial ativa:
      `SUBMITTED` e `IN_REVIEW`, ordenada por prioridade (`URGENT` primeiro) e tempo parado.
  - [ ] Esta tela é a **base** do dashboard da unidade na FASE 10.
  - [ ] Colunas: número, solicitante, itens, prioridade, tempo aberto, status de análise.
  - [ ] Ação rápida "assumir".

### 08.6 — Entrega

- [ ] `src/app/(app)/entregas/page.tsx` — solicitações aprovadas aguardando entrega.
- [ ] `src/app/(app)/entregas/[requestId]/page.tsx`:
  - [ ] Lista para conferência com quantidade aprovada (padrão) e campo para
        quantidade **realmente entregue** (permite divergência na entrega).
  - [ ] Campos de recebimento: nome de quem recebeu, documento (CPF), observação.
  - [ ] Confirmação final mostra o impacto no saldo de cada item antes de concluir.
  - [ ] Ao concluir: baixa, status `DELIVERED`, comprovante disponível.
- [ ] Comprovante em `/entregas/[requestId]/comprovante` — layout de impressão,
      com número, itens, quantidades, assinaturas e data.

## Testes obrigatórios

`__tests__/request-transitions.test.ts`:

- [ ] Todas as transições válidas passam; todas as inválidas lançam `InvalidTransitionError`.

`__tests__/request-approve.test.ts`:

- [ ] Aprovar total cria reserva para cada linha e aumenta `reservedQuantity`.
- [ ] Aprovar parcial exige justificativa por linha não aprovada.
- [ ] Aprovar mais que o disponível falha com mensagem clara.
- [ ] Rejeitar libera reservas e notifica o solicitante (log).

`__tests__/request-deliver.test.ts`:

- [ ] Entregar gera `StockDocument` `ISSUE` e consome a reserva.
- [ ] Entregar menos que o aprovado libera a diferença da reserva.
- [ ] Não é possível entregar item sem reserva.
- [ ] Entregar solicitação de outra filial é bloqueado (`requireBranch`).

`__tests__/request-submit.test.ts`:

- [ ] Enviar define `responsibleId` e cria `RequestEvent`.
- [ ] Disponibilidade calculada por filial (item disponível na matriz e indisponível na filial A
      aparece `UNAVAILABLE` na filial A).

## Critérios de aceite

- [ ] Um `SOLICITANTE` comum cria e envia uma solicitação sem ver nenhum menu administrativo.
- [ ] A solicitação aparece na fila do `ADMIN_FILIAL` da unidade.
- [ ] Aprovação parcial fica clara para o solicitante (o que foi aprovado e o que não, e por quê).
- [ ] A entrega dá baixa no estoque e o saldo reflete imediatamente.
- [ ] O solicitante consegue ver o comprovante com nome de quem recebeu.
- [ ] Um `SOLICITANTE` não abre nem altera solicitação de outra pessoa
      (403 na página e na action).
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passam.

## Fora do escopo

Aprovação por valor/categoria configurável (FASE 13), notificação por e-mail
(SMTP não definido), comprovante em PDF assinado digitalmente, центagem de compras.
