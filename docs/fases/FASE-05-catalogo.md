# FASE 05 — Catálogo de materiais

> Categorias, unidades de medida, materiais, controle por lote e leitura de código de barras.

## Contexto

Nada funciona sem o catálogo: é ele que as solicitações, os saldos e as transferências
consomem. O detalhe crítico é que o **mesmo material pode ter políticas diferentes em cada
filial** (mínimo, se exige aprovação), então catálogo e política são separados.

## Pré-requisitos

- FASE 04 concluída (filiais e locais de estoque).
- FASE 01: `Category`, `Unit`, `Item`, `ItemLot`, `ItemStockPolicy` existentes.

## Tarefas

### 05.1 — Unidades de medida

- [ ] `src/lib/validation/unit.ts` — `code` 1–6 caracteres uppercase, `name`,
      `allowsDecimals`.
- [ ] Tela `src/app/(app)/catalogo/unidades/page.tsx` — CRUD completo, com as
      convencionais já seedadas (UN, KG, G, L, ML, M, CX, PC, DZ, FD, PCT, HR) marcadas
      como **padrão** e não editáveis em `code`.
- [ ] Service em `src/server/services/catalog/unit.ts`.
- [ ] Bloquear exclusão de unidade em uso (`Item.unitId` referenciando) — desativar
      em vez de excluir.

### 05.2 — Categorias (hierárquicas)

- [ ] `src/lib/validation/category.ts` — `code`, `name`, `parentId`, `description`,
      `requiresApproval` (a categoria define se o material exige aprovação).
- [ ] `src/app/(app)/catalogo/categorias/page.tsx`:
  - [ ] Árvore de categorias em accordion, com contagem de materiais por categoria.
  - [ ] Criação/edição de filho a partir do nó pai.
  - [ ] Indentação visual clara, drag-and-drop opcional (não obrigatório).
  - [ ] Busca por nome/código.
- [ ] Service com proteção de ciclo (`parentId` não pode ser a si mesmo nem descendente).
- [ ] Ações com `requirePermission("categoria:manage")`.

### 05.3 — Materiais

`src/lib/validation/item.ts`:

- [ ] `code` — SKU, uppercase, 2–30, único, gerado automaticamente a partir de
      prefixo da categoria quando deixado em branco (ex.: `EPI-0001`).
- [ ] `barcode` — 8, 12, 13 ou 14 dígitos; validação de dígito verificador EAN/UPC.
- [ ] `name`, `description`, `categoryId`, `unitId`.
- [ ] `referencePrice` — Decimal, ≥ 0.
- [ ] Flags: `controlledByLot`, `perishable`, `requiresApproval`, `hasSerialControl`.
  - [ ] `perishable` exige `controlledByLot = true`.
  - [ ] `requiresApproval` herda o padrão da categoria, mas pode ser sobrescrito.
- [ ] `active`.

`src/server/services/catalog/item.ts`:

- [ ] `create`, `update`, `deactivate` (soft), `duplicate` (criar variação a partir de
      um modelo — útil para Sizes/cores de EPI).
- [ ] `assignPolicy` — `ItemStockPolicy` por filial (mínimo, máximo, alerta, consumo médio).
  - [ ] Ação em lote: "aplicar a todas as filiais" e "aplicar a uma filial".
- [ ] Listagem com filtro por categoria, unidade, status, somente itens sem política,
      e busca por código/nome/código de barras.

### 05.4 — Telas de materiais

- [ ] `src/app/(app)/catalogo/itens/page.tsx` — tabela densa (o almoxarife vive aqui):
      código, nome, categoria, unidade, preço de referência, controlado por lote,
      ativo. Busca com **debounce**, filtros na URL, coluna de saldo da filial ativa
      (ícone de alerta se abaixo do mínimo), ordenação, paginação.
- [ ] `src/app/(app)/catalogo/itens/novo/page.tsx` — formulário em duas colunas:
      identificação à esquerda, opções e política à direita.
- [ ] `src/app/(app)/catalogo/itens/[id]/page.tsx` — tabs:
      `Dados` · `Lotes` · `Política por filial` · `Movimentações` (link para a FASE 06) ·
      `Uso em solicitações`.
- [ ] Ações em `src/server/actions/item.ts`, `category.ts`, `unit.ts`.
- [ ] `loading.tsx` e `error.tsx` em todas as rotas.

### 05.5 — Leitura de código de barras

- [ ] `pnpm add @zxing/browser`
- [ ] `src/components/domain/barcode-scanner.tsx` — componente client que:
  - [ ] Abre a câmera, com botão de fallback para **entrada manual** (essencial:
        notebook do almoxarife sem câmera, ou permissão negada).
  - [ ] Resolve o código lido para um `Item` via Server Action `lookupByBarcode`
        (com `scopeBranch` — item não precisa ser escopado, mas o local/saldo sim).
  - [ ] Emite `onScan(code, item)` para o formulário pai.
- [ ] Integrar em:
  - [ ] `/solicitacoes/nova` (busca rápida de item) — a tela é da FASE 08, deixar o
        componente pronto e testado aqui.
  - [ ] `/estoque/entradas` e `/estoque/ajustes` (FASE 06) — apenas componentizar agora.
- [ ] `src/components/domain/item-combobox.tsx` — autocompletar item com busca por
      nome/código/barcode, botão de scanner embutido.

### 05.6 — Lotes

- [ ] `src/app/(app)/catalogo/itens/[id]/lotes` — CRUD de `ItemLot`
      (código do lote, validade, quantidade inicial) para itens `controlledByLot`.
- [ ] Destacar lotes vencidos e a vencer em 30 dias.

## Testes obrigatórios

- [ ] Validação de EAN-13 com dígito verificador correto e incorreto.
- [ ] `create` de item com SKU duplicado falha.
- [ ] `perishable` sem `controlledByLot` é rejeitado pelo schema.
- [ ] Proteção de ciclo em `Category`.
- [ ] `assignPolicy` em lote para múltiplas filiais cria os registros corretos.
- [ ] Desativar unidade em uso é bloqueado com mensagem clara.
- [ ] `lookupByBarcode` retorna o item correto e falha com `NotFoundError` se não existir.

## Critérios de aceite

- [ ] Item criado aparece imediatamente na listagem e no autocompletar.
- [ ] Buscar pelo código de barras encontra o item.
- [ ] Item sem política de mínimo mostra o filtro "somente sem política".
- [ ] Mínimo definido para uma filial **não** aparece nas outras.
- [ ] Desativar item com histórico preserva o histórico e some das telas de seleção.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passam.

## Fora do escopo

Importação de itens via CSV, integração com código de barras GS1 real,
fotos/galeria de materiais, gestão de kits/compostos de materiais.
