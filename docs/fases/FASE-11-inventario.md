# FASE 11 — Inventário

> Contagem física por local, comparação com o sistema e ajuste por divergência.

## Contexto

O inventário é a garantia de que o `StockLevel` bate com a realidade. Não é "contar
tudo de novo" — é contar o que faz tempo que não se movimenta, detectar divergência e
lançar o ajuste com justificativa. Reusa o motor da FASE 06.

## Pré-requisitos

- FASE 06 concluída (motor de `StockDocument`).
- FASE 09 (notificação `INVENTORY_DIVERGENCE`).

## Máquina de estados

```
OPEN ──iniciar contagem──▶ COUNTING ──fechar──▶ CLOSED ──ajustar──▶ ADJUSTED
   └─cancelar──▶ CANCELLED
```

## Tarefas

### 11.1 — Service de inventário

`src/server/services/inventory/`:

- [ ] `create.ts` — cria sessão `OPEN` com escopo (filial + local + categoria opcional).
  - [ ] Opção `onlyWithoutMovement` (itens sem movimentação há N dias) — usa
        `StockLevel.lastMovementAt`.
  - [ ] Congela as quantidades do sistema em `InventoryLine.systemQuantity` **no momento
        da criação da linha**, e cada item tem um botão de recontagem que atualiza
        o valor de sistema.
  - [ ] **Não** bloqueia o uso do item durante a contagem (decisão consciente: contagem
        parcial, ajustes no fechamento).
- [ ] `count.ts` — salva `countedQuantity` por linha; aceita contagem parcial
      (deixar em branco = "não contado", não zero).
- [ ] `close.ts`:
  - [ ] Calcula `difference = counted - system` por linha.
  - [ ] Exige justificativa para toda linha com `difference != 0`.
  - [ ] Gera **um** `StockDocument` `INVENTORY` com o total das diferenças.
  - [ ] Status `ADJUSTED` e `closedAt`/`closedById`.
  - [ ] Dispara `INVENTORY_DIVERGENCE` (deduplicado) para `ADMIN_FILIAL` e `ADMIN_MATRIZ`.
- [ ] `cancel.ts` — sessão `OPEN` sem ajuste, com motivo.
- [ ] `transitions.ts` e `numbering.ts` (`INV-2026-000003`).

### 11.2 — Ações

- [ ] `src/server/actions/inventory.ts` — `criarSessao`, `salvarContagem`,
      `recontarItem`, `fecharSessao`, `cancelarSessao`, `exportarPlanilha`.
- [ ] `requirePermission("inventario:manage")` em toda escrita,
      `requirePermission("inventario:read")` na leitura, `requireBranch` sempre.

### 11.3 — Telas

- [ ] `src/app/(app)/inventario/page.tsx` — sessões da filial, com filtros de status
      e período; card de "sessões abertas" e "pendentes de ajuste".
- [ ] `src/app/(app)/inventario/nova/page.tsx` — wizard:
  1. Filial, local, categoria, filtro "somente sem movimentação".
  2. Pré-visualização da quantidade de itens a contar.
  3. Confirmação e criação.
- [ ] `src/app/(app)/inventario/[id]/page.tsx` — a tela de contagem, otimizada para
  balcão:
  - [ ] Lista de itens com código de barras, nome, unidade, **quantidade do sistema**
        (visível, mas com opção "ocultar sistema" para contar às cegas — decisão importante
        de processo).
  - [ ] Campo de contagem com input numérico grande, ideal para uso com luva/dedo.
  - [ ] Campo "não contado" explícito (evita o erro de digitar 0).
  - [ ] Indicador de progresso: "42 de 130 contados".
  - [ ] Filtro "só não contados" e busca.
  - [ ] Salvar automático (debounce) com indicador discreto de "salvo".
  - [ ] Integração do `BarcodeScanner` (FASE 05): ler o código já foca e preenche o item.
  - [ ] Botão "finalizar contagem" → resumo de divergências → tela de ajuste.
- [ ] `src/app/(app)/inventario/[id]/ajustar/page.tsx` — resumo de divergências por item,
      justificativa por linha, confirmação do documento gerado, link para o
      `StockDocument` de ajuste.
- [ ] Exportar a planilha de contagem em CSV (item, código, barra, sistema, campo em branco
  para imprimir).
- [ ] `loading.tsx` e `error.tsx`.

## Testes obrigatórios

- [ ] Criar sessão copia corretamente a quantidade de sistema.
- [ ] Contagem parcial aceita; linha em branco fica "não contada", não zero.
- [ ] Fechar com divergência gera `StockDocument` `INVENTORY` e corrige o `StockLevel`.
- [ ] Fechar sem justificativa em linha divergente é rejeitado.
- [ ] Fechar sem contagem é bloqueado.
- [ ] Divergência dispara `INVENTORY_DIVERGENCE` uma única vez.
- [ ] Cancelar sessão não altera nenhum saldo.
- [ ] `ADMIN_FILIAL` não abre inventário de outra filial.

## Critérios de aceite

- [ ] Contagem de 20 itens em tablet funciona sem travar e salva de forma confiável.
- [ ] Ler o código de barras foca o item correto na lista.
- [ ] Fechar o inventário corrige o saldo exatamente pela soma das divergências.
- [ ] CSV de contagem é utilizável em papel.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passam.

## Fora do escopo

Inventário cíclico automático, dupla contagem cega, inventário de imobilizado.
