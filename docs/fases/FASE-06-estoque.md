# FASE 06 — Estoque: saldos e movimentações

> Ledger de estoque transacional: entradas, saídas, ajustes, saldo por local e custo médio.

## Contexto

Coração do ERP. Esta fase cria a verdade do estoque (`StockDocument` + `StockLine`,
append-only) e o cache materializado (`StockLevel`). Tudo aqui tem que ser transacional
e nunca produzir saldo negativo.

## Pré-requisitos

- FASE 05 concluída (itens, unidades, lotes, mínimos por filial).
- FASE 01: `StockLevel`, `StockDocument`, `StockLine`, `StockReservation` existentes.

## Regras críticas (revisitar `AGENTS.md` §3.3)

1. Nenhum `update`/`delete` em `StockDocument`/`StockLine`.
2. Toda alteração de saldo passa por `postStockDocument()`.
3. Transação + lock na `StockLevel`.
4. Saldo negativo proibido → `InsufficientStockError`.
5. Número do documento sequencial por filial (`MV-2026-000001`), sem gap em falha
   (usar sequência do Postgres ou `count` dentro da transação com retry).

## Tarefas

### 06.1 — Motor de movimentações

`src/server/services/stock/`:

- [ ] `lock.ts` — `lockStockLevels(tx, keys)` com `SELECT ... FOR UPDATE` via
      `$queryRaw`, ordenando as chaves para evitar deadlock.
- [ ] `post-document.ts` — coração do sistema:
  - [ ] Valida documento e linhas.
  - [ ] Trava as `StockLevel` afetadas.
  - [ ] Valida saldo disponível (`quantity - reservedQuantity`) para saídas.
  - [ ] Valida lote válido e não vencido quando `controlledByLot`.
  - [ ] Atualiza `StockLevel.quantity`, `averageCost` (média ponderada na entrada),
        `version + 1`, `lastMovementAt`.
  - [ ] Insere `StockLine` (append-only).
  - [ ] Marca documento `POSTED` com `postedAt`.
  - [ ] Avalia `ItemStockPolicy` e dispara alerta `STOCK_BELOW_MIN` (deduplicado —
        hook registrado, disparo efetivo na FASE 09; aqui só loga e calcula o flag).
  - [ ] Grava `AuditLog`.
  - [ ] Tudo dentro de `prisma.$transaction` com timeout explícito e `maxWait`.
- [ ] `cancel-document.ts` — gera **documento inverso** do mesmo tipo com
      `referenceType = "CANCELLED_DOCUMENT"`, nunca apaga o original.
- [ ] `average-cost.ts` — função pura `computeAverageCost(currentQty, currentCost, inQty, inCost)`
      com teste dedicado (inclui o caso de entrada em qty zero).
- [ ] `numbering.ts` — geração de número sequencial por filial, com retry em conflito.
- [ ] `types.ts` — `PostDocumentInput` bem tipado, sem `any`.

### 06.2 — Reservas

- [ ] `src/server/services/stock/reservation.ts`:
  - [ ] `reserveForRequestLine()` — cria `StockReservation` e incrementa
        `StockLevel.reservedQuantity`, validando disponibilidade.
  - [ ] `releaseReservation()` — ao rejeitar/cancelar.
  - [ ] `consumeReservation()` — na entrega: reduz `reservedQuantity` **e** a quantidade
        via documento de saída.
  - [ ] Liberação automática de reservas quando a `ItemStockPolicy` da filial for
        desativada ou o item for desativado.
- [ ] Testes de cada operação, incluindo reserva maior que o disponível (falha).

### 06.3 — Entradas

- [ ] `src/lib/validation/stock-document.ts` — Zod para cabeçalho e linhas.
- [ ] `src/server/actions/stock.ts` — `criarEntrada`, `criarAjuste`, `cancelarDocumento`,
      `postDocumento`, `rascunhoDocumento`.
- [ ] `src/app/(app)/estoque/entradas/page.tsx` — lista de entradas.
- [ ] `src/app/(app)/estoque/entradas/nova/page.tsx`:
  - [ ] Cabeçalho: data, local de destino, observação, documento de referência
        (nota fiscal / OS), código do fornecedor.
  - [ ] Linhas: `ItemCombobox` + scanner, quantidade, custo unitário, lote (condicional).
  - [ ] Rodapé: total de itens, custo total, botão "salvar rascunho" e "lançar".
  - [ ] Lançar abre confirmação com o impacto no saldo.
- [ ] Ajuste: `/estoque/ajustes/nova` — **justificativa obrigatória** (Zod `min`),
      e o motivo fica registrado no documento e no `AuditLog`.

### 06.4 — Saldos

- [ ] `src/app/(app)/estoque/saldos/page.tsx`:
  - [ ] Tabela por item × local: `quantity`, `reservedQuantity`, `available`,
        `minimumQuantity` com semaforo (verde / amarelo / vermelho), custo médio,
        valor total.
  - [ ] Filtros: filial ativa, local, categoria, somente abaixo do mínimo,
        somente sem movimento há N dias, busca por nome/código.
  - [ ] Cabeçalho com resumo: valor total, nº de itens abaixo do mínimo.
  - [ ] Exportar CSV da consulta atual (respeitando os filtros da URL).
- [ ] `src/app/(app)/estoque/saldos/[itemId]/page.tsx` — histórico de saldo do item
      na filial, com linha do tempo das movimentações e sparkline de evolução.

### 06.5 — Movimentações

- [ ] `src/app/(app)/estoque/movimentacoes/page.tsx`:
  - [ ] Filtros: período, tipo, filial, local, item, documento. Tudo na URL.
  - [ ] Colunas: número, data, tipo (badge por tipo), origem (documento vinculado),
        local, itens, quantidade total, valor, autor.
  - [ ] `/[id]` — cabeçalho + linhas, com o item em destaque e link para o documento de origem.
- [ ] Filtros rápidos salvos: "entradas do mês", "saídas do mês", "ajustes do período".

### 06.6 — Widgets de reabastecimento

- [ ] `src/app/(app)/estoque/page.tsx` (índice do módulo) — cards:
      itens abaixo do mínimo, valor de estoque, movimentações do dia, últimos ajustes.
- [ ] Serviço `src/server/services/stock/alerts.ts` com `listBelowMinimum(ctx)`.
- [ ] A partir daqui, essa função é a **fonte única** consumida pelos dashboards
      da FASE 10.

## Testes obrigatórios

`src/server/services/stock/__tests__/post-document.test.ts`:

- [ ] Entrada cria saldo e linha com sinal `+`.
- [ ] Saída com saldo suficiente debita corretamente.
- [ ] Saída com saldo insuficiente lança `InsufficientStockError` e **não** altera nada.
- [ ] Saída respeita `reservedQuantity` (não consome o reservado).
- [ ] Entrada com qty zero recalcula custo médio corretamente.
- [ ] Lote vencido é rejeitado.
- [ ] Ajuste com justificativa ausente é rejeitado pelo Zod.
- [ ] Cancelar documento gera inverso e devolve o saldo.
- [ ] Duas transações concorrentes no mesmo item não corrompem o saldo
      (teste com `Promise.all` sob a mesma chave).

`__tests__/average-cost.test.ts` — casos de média ponderada, incluindo zerar.

`__tests__/reservation.test.ts` — reservar, liberar, consumir; e falha por insuficiência.

`__tests__/numbering.test.ts` — sequência por filial, sem colisão sob concorrência.

## Critérios de aceite

- [ ] Entrada de 100 unidades de um item novo cria saldo 100 e aparece em `/estoque/saldos`.
- [ ] Tentar saída maior que o disponível falha com mensagem clara em português e nada muda no banco.
- [ ] `StockDocument` `POSTED` não pode ser editado nem removido pela aplicação
      (verificar também no Prisma: sem `update`/`delete` expostos nas actions).
- [ ] Cancelar um lançamento devolve exatamente o saldo anterior.
- [ ] Custo médio muda corretamente a cada entrada.
- [ ] Filtros de movimentações sobrevivem a copiar a URL.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passam.

## Fora do escopo

Reserva automática de compra, integração com fornecedor, nota fiscal eletrônica,
contabilidade (o ERP é de almoxarifado, não financeiro).
