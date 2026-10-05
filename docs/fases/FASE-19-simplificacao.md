# FASE 19 — Simplificação: o caminho da doca e o menu por tarefa

> Um teste real em produção mostrou que o caminho principal morre: na doca, o
> código de barras de um produto novo devolve "Nenhum material com este código de
> barras" e o usuário precisa sair da entrada, cadastrar o material em uma tela de
> 11 campos e voltar. Pior: em produção **não existe nenhuma categoria** (o seed
> só cria categorias com `SEED_DEMO_DATA`), e `Item.categoryId` é obrigatório —
> então `/catalogo/itens/novo` abre com um select vazio e nenhuma explicação.
>
> Esta fase não muda regra de negócio de estoque, solicitação ou chamado. Muda
> **como a interface acompanha o pensamento natural do usuário**.

## Contexto

O foco do produto é um almoxarifado por unidade: material **entra** (leitura de
código de barras com a câmera do celular) e material **sai** (solicitação feita
ao almoxarifado ou à T.I., como já é hoje). O caminho entre os dois não pode ter
passo de cadastro que só o sistema sabe que é obrigatório.

Três decisões de produto fecharam o escopo:

1. **Só código de barras.** Sem OCR de nota fiscal nem leitura de comprovante.
2. **Categoria "Geral" automática**, invisível no caminho principal. O banco
   continua com `categoryId` obrigatório — sem migration.
3. **Sem roteiro.** Nenhum card de "primeiros passos": cada tela vazia diz o que
   falta e oferece o botão ali mesmo.

A categoria `Geral` **não exige aprovação**: o pedido continua passando pela fila
de quem responde (§3.7 do AGENTS.md), só sem um clique extra de portão.

## Pré-requisitos

- FASE 18 concluída.

## Tarefas

### Etapa 1 — Destravar o caminho

- [x] `ensureGeneralCategory()` em `src/server/services/catalog/category.ts`:
      `upsert` da categoria de código `GERAL`, chamada pelo serviço de criação de
      material (não só pelo seed) — qualquer instalação passa a ter uma.
- [x] `itemQuickSchema` em `src/lib/validation/catalog.ts`: nome + unidade +
      código de barras. `itemSchema`/`itemUpdateSchema` seguem como estão (a tela
      de edição é completa).
- [x] `createItem` aceita os dois formatos; o rápido vira o completo em
      `completeQuickInput()` num ponto só.
- [x] `/catalogo/itens/novo`: `Nome` + `Unidade` visíveis. `Categoria` é select
      **opcional** já preenchido com `Geral` (sem asterisco no cadastro). Preço,
      código, código de barras, descrição e controles de
      lote/perecível/aprovação/série vão para "Opções avançadas" (recolhido).
- [x] `createBranch()` cria o local `ALMOX — Almoxarifado Central` na mesma
      transação. O card "Nenhum local de estoque cadastrado" fica só como
      fallback de filial antiga. O seed passa a usar as mesmas constantes.
- [x] Estados vazios que ensinam: Saldos ganhou ação "Registrar entrada"; Materiais
      agora diz que o material pode ser cadastrado pela câmera na entrada.
- [x] **`item:create` no papel ALMOXARIFE.** Sem isto o caminho da doca morre para
      quem opera: ele não conseguia cadastrar o material que está anotando.

### Etapa 2 — A doca: entrada pela câmera, sem cadastro prévio

- [x] `buscarPorCodigoBarrasAction` devolve `null` para material não encontrado
      (não é erro) — o seletor distingue "não existe" de "deu problema".
- [x] `criarItemRapidoAction`: valida → `requirePermission("item:create")` →
      serviço → `revalidatePath`, e devolve a linha pronta em vez de redirecionar.
- [x] `ItemCombobox`: código lido sem material abre o cadastro mínimo (Nome +
      Unidade) que cria o material e já adiciona a linha do documento. Mesmo
      caminho ao **digitar** o código sem resultado (balcão sem celular).
- [x] `ItemPickOption` em `src/lib/item-option.ts`: serviço e componente passam a
      falar o mesmo formato, sem remontar objeto no cliente — e sem o componente
      cliente importar de `server/` (§4).

### Etapa 3 — Menu redesenhado por tarefa

- [x] `src/lib/navigation.ts` reescrito na ordem em que o trabalho acontece:
      **Ação** → **Insumo** → **Consumo** → **Manutenção** → **Monitoramento** →
      **Configurações** → **Avançado**.
- [x] `requiresNetwork`: transferência só aparece com 2+ unidades ativas
      (contagem no layout).
- [x] Nenhum `href` em dois grupos. De ~20 itens visíveis para 6 grupos.
- [ ] **Não feito — hubs com abas.** `/estoque` e `/solicitacoes` com abas
      exigiriam extrair cinco listadores (Server Components com filtros próprios)
      para componentes compartilhados. Refactor grande, de risco alto, com ganho
      pequeno: o agrupamento do menu já resolveu o ruído. As rotas atuais seguem
      como estão. Reavaliar se a operação de estoque virar carga.

### Etapa 4 — Fechamento

- [x] `docs/ARQUITETURA.md`: §5.1.2 (entrada pela doca) e §9.1 (navegação).
- [x] `AGENTS.md`: §3.11 (regra de produto) e §7 (menu).
- [x] E2E: material novo lido por código de barras entra no estoque
      (`e2e/estoque.spec.ts`), com código novo por execução para ser repetível.
- [x] Bug pré-existente corrigido no caminho: `loginWithCredentialsAction` deixava
      o `AuthError` do Auth.js v5 escapar e a tela de login caía no error
      boundary em vez de dizer "e-mail ou senha inválidos".
- [x] E2E pré-existente corrigido: `reparos-ti.spec.ts` usava um e-mail de técnico
      que o seed não cria.
- [x] **Câmera do leitor corrigida** (bug da FASE 05): lia a ref do `<video>`
      antes do elemento existir, então o clique morria em silêncio. Passou a
      inicializar em efeito, depois do elemento montado. E2E com câmera sintética
      exige o stream real no vídeo e a liberação ao parar.
- [x] `unsafe-eval` na CSP apenas em desenvolvimento (runtime dev do React);
      produção inalterada.

## Fora do escopo

- Fluxo de solicitação de material, chamado de reparo/T.I., entrega e
  comprovante — **como já são hoje**.
- OCR, leitura de nota fiscal, comprovante de entrega por QR.
- Tirar a categoria do `schema.prisma` (sem migration nesta fase).
- Criar categoria de dentro do formulário de material: somaria um controle ao
  caminho que existe justamente para ser curto. A categoria se ajusta depois, em
  `/catalogo/categorias`.
- `StockDocument`/`StockLine`, saldo, reserva e máquina de estados (§3.3/§3.4).

## Critérios de aceite

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:seed`.
- [x] Em uma instalação nova, o usuário chega ao primeiro material sem nenhum
      passo de cadastro que o sistema não tenha dito.
- [x] Na doca, um código de barras de produto novo vira uma linha de entrada sem
      sair da tela.
- [x] O menu mostra o que a unidade usa, na ordem em que o trabalho acontece.
- [x] E2E local verde (`E2E_AUTH_BYPASS=true pnpm e2e --project=chromium`) — 87/87.