# FASE 07 — Transferências entre unidades

> Movimento de material entre matriz e filiais, com envio, recebimento e devolução.

## Contexto

Cada unidade tem estoque próprio. A matriz repõe as filiais e, quando uma filial tem
excesso, devolve para a matriz ou manda para outra. Esta fase implementa o fluxo completo
com rastreabilidade dos dois lados (baixa na origem e entrada no destino são documentos
de estoque automáticos).

## Pré-requisitos

- FASE 06 concluída (motor de `StockDocument` e saldos).
- FASE 01: `Transfer`, `TransferLine` existentes.

## Máquina de estados

```
DRAFT ──enviar──▶ SENT ──▶ IN_TRANSIT ──receber──▶ RECEIVED
  │                 │            │
  └─cancelar────────┴─cancelar───┴─devolver──▶ RETURNED
```

Regras (de `ARQUITETURA.md` §5.5):

- `SENT` já **baixa o saldo na origem** (documento `TRANSFER_OUT`) e **envia a notificação**
  ao destino.
- `IN_TRANSIT` é o estado automático logo após o `TRANSFER_OUT`; serve para rastrear
  o que está em trânsito e aparece no dashboard da matriz.
- Recebimento pode ser **parcial**: `quantityReceived < quantitySent`. O excedente fica
  marcado e o destinatário pode devolver (`RETURNED`), gerando `TRANSFER_IN` de volta na origem.
- Quem envia: `ALMOXARIFE` / `ADMIN_FILIAL` na origem.
- Quem recebe: `ALMOXARIFE` / `GESTOR` / `ADMIN_FILIAL` no destino.

## Tarefas

### 07.1 — Service de transferência

`src/server/services/transfer/`:

- [ ] `create.ts` — cria `DRAFT` com linhas; valida origem ≠ destino.
- [ ] `send.ts`:
  - [ ] Valida estoque disponível na origem por item/local.
  - [ ] Gera `StockDocument` `TRANSFER_OUT` na origem (reusa `postDocument` da FASE 06).
  - [ ] Atualiza `Transfer` para `SENT`/`IN_TRANSIT`, grava `sentById`, `sentAt`.
  - [ ] Registra a observação "aguardando recebimento".
  - [ ] **Deixa o gancho de notificação** `TRANSFER_SENT` (disparo real na FASE 09).
- [ ] `receive.ts`:
  - [ ] Grava `quantityReceived` por linha, aceitando parcial.
  - [ ] Gera `StockDocument` `TRANSFER_IN` no destino.
  - [ ] Se recebimento total → `RECEIVED`. Se parcial → deixa em `IN_TRANSIT` com
        aviso de pendência e marca as linhas recebidas.
  - [ ] Se recebimento for 0 em todas as linhas → `RETURNED`.
- [ ] `return.ts` — devolução: gera `TRANSFER_IN` na origem e `TRANSFER_OUT` no destino.
- [ ] `cancel.ts` — permitido em `DRAFT`/`SENT` (antes de sair). Se já `IN_TRANSIT`,
      cancelamento vira devolução (não Some com o material).
- [ ] `transitions.ts` — tabela de transições válidas, com `InvalidTransitionError`.
- [ ] `numbering.ts` — `TR-2026-000012` por filial de origem.

### 07.2 — Ações

- [ ] `src/server/actions/transfer.ts` — `criarTransferencia`, `adicionarLinha`,
      `removerLinha`, `enviarTransferencia`, `receberTransferencia`, `devolverTransferencia`,
      `cancelarTransferencia`.
- [ ] Cada ação: Zod → `requirePermission` → `requireBranch(transfer.destinationBranchId)`,
      `requireBranch(transfer.originBranchId)`, `assertBranchAccess` nos dois lados,
      service, `revalidatePath`, `ActionResult`.
- [ ] Nunca permitir que uma filial crie transferência **recebendo** algo que ela não tem.

### 07.3 — Telas

- [ ] `src/app/(app)/transferencias/page.tsx` — lista com filtros (status, origem,
      destino, período, item) na URL. Abas: `A enviar`, `Em trânsito`, `Recebidas`, `Todas`.
      Badge de "chegando em você" nas transferências com destino = filial ativa.
- [ ] `src/app/(app)/transferencias/nova/page.tsx`:
  - [ ] Origem (filial ativa) e destino (select de filiais ativas, excluindo a origem).
  - [ ] Linhas com `ItemCombobox` + scanner, quantidade por local de origem.
  - [ ] Validação em tempo real de disponibilidade por item com aviso antes de enviar.
  - [ ] Botão "salvar rascunho" e "enviar".
- [ ] `src/app/(app)/transferencias/[id]/page.tsx`:
  - [ ] Cabeçalho com status, origem/destino, datas, responsáveis.
  - [ ] Tabela de linhas com `quantitySent` vs `quantityReceived` e destaque do saldo.
  - [ ] Ações contextuais conforme status: enviar, receber, devolver, cancelar.
  - [ ] Timeline de eventos (reaproveitar componente de `RequestEvent` da FASE 08,
        generalizando para `TransferEvent`).
  - [ ] Link para os `StockDocument`s gerados.
- [ ] `loading.tsx` e `error.tsx` em todas as rotas.

### 07.4 — Painel de trânsito

- [ ] `src/app/(app)/transferencias/em-transito/page.tsx` — o que está a caminho da filial ativa
      e o que a filial ativa tem a caminho de outras.
- [ ] Badge no menu lateral com o número de transferências a receber na filial ativa.

## Testes obrigatórios

- [ ] Enviar transferência gera `TRANSFER_OUT` e baixa o saldo da origem.
- [ ] Enviar sem saldo suficiente falha sem efeito colateral.
- [ ] Receber gera `TRANSFER_IN` e credita o destino.
- [ ] Recebimento parcial: destino recebe o que foi recebido, status continua em trânsito,
      excedente fica marcado.
- [ ] Devolução credita a origem novamente e zera a pendência.
- [ ] Transições inválidas (receber já recebida, enviar rascunho de outra filial) lançam erro.
- [ ] `ADMIN_FILIAL` da filial A não consegue abrir nem receber transferência da filial B.
- [ ] Cancelar em `SENT` antes do `TRANSFER_OUT` reverte o saldo corretamente.
- [ ] Concorrência: duas transferências do mesmo item com saldo apertado — uma passa,
      a outra falha (sem saldo negativo).

## Critérios de aceite

- [ ] Fluxo completo matriz → filial executado no navegador sem erro.
- [ ] Saldo da origem e do destino conferidos manualmente batem com o esperado.
- [ ] Transferência em trânsito aparece no dashboard da matriz (indicador preparado).
- [ ] Recebimento parcial gera aviso claro sobre o material faltante.
- [ ] Devolução devolvida aparece na origem e o estoque volta ao valor original.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passam.

## Fora do escopo

Transferência automática por nível de mínimo, cotação entre filiais, transportadora
e rastreio físico.
