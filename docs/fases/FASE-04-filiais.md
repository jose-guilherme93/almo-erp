# FASE 04 — Cadastro de filiais e locais de estoque

> Cadastro completo de matriz e unidades, com responsáveis, endereço, e locais de almoxarifado.

## Contexto

O usuário pediu: "tem que ter informação de cadastro de filial etc, de maneira bem completa".
Esta fase entrega o CRUD completo de `Branch` conforme `ARQUITETURA.md` §2, mais os
`StorageLocation` que dão destino físico ao estoque (chave da FASE 06).

## Pré-requisitos

- FASE 03 concluída (RBAC + `requireBranch` funcionando).
- FASE 01: modelos `Branch`, `StorageLocation`, `Config` existentes.

## Tarefas

### 04.1 — Validações e schemas

- [ ] `src/lib/validation/branch.ts` com Zod:
  - [ ] `code` — uppercase, `[A-Z0-9-]{2,20}`, único (checagem no service, não no schema).
  - [ ] `cnpj` — 14 dígitos, validação dos dígitos verificadores,
        `normalizeCnpj()` (só dígitos), máscara em `00000.000/0000-00`.
  - [ ] `stateRegistration` — opcional, máscara por UF, validação por UF.
  - [ ] `cnae` — 7 dígitos, opcional.
  - [ ] `zipCode` — 8 dígitos, máscara, validação de dígito verificador quando aplicável.
  - [ ] `state` — enum de 27 UFs.
  - [ ] `phone` / `whatsapp` — máscara, opcional, E.164 para armazenamento.
  - [ ] `email` — corporate check da FASE 02 para e-mails de contato.
  - [ ] `latitude` / `longitude` — quando presentes, `-90..90` e `-180..180`.
  - [ ] `businessHours` — objeto json validado (abertura/fechamento por dia, opcional).
  - [ ] `parentId` — quando preenchido, não pode gerar ciclo na hierarquia.
- [ ] Testes unitários de `cnpj` (válido, inválido, letras) e `zipCode`.
- [ ] `src/lib/validation/storage-location.ts`.
- [ ] `src/lib/uf.ts` — lista de UFs com nomes, para selects e máscaras.

### 04.2 — Service de filial

`src/server/services/branch/`:

- [ ] `create.ts` — valida `code`/`cnpj` únicos, cria a filial, grava `AuditLog`.
- [ ] `update.ts` — diff de `before`/`after` no `AuditLog`.
- [ ] `deactivate.ts` — **bloqueia desativação se**: houver `Transfer` pendente
      (status `SENT`/`IN_TRANSIT`) recebido/enviado, ou `InventorySession` aberto.
      Mantém histórico legível.
- [ ] `reorder-hierarchy.ts` ou `move.ts` — reparentar com proteção de ciclo.
- [ ] `list.ts` — com `branchFilter` e ordenação; `ADMIN_FILIAL` só vê a sua.

### 04.3 — Telas de filial

Rotas em `src/app/(app)/filiais/`:

- [ ] `page.tsx` — tabela: código, nome, tipo, cidade/UF, responsável pelo almoxarifado,
      aprovador padrão, status, ações. Busca, filtro por tipo/cidade/UF/status, ordenação,
      paginação na URL. `ADMIN_FILIAL` vê apenas a sua linha.
- [ ] `novo/page.tsx` — **wizard de 3 passos** (identificação → endereço e contato →
      responsáveis e operação), com revisão final antes de salvar. Barra de progresso,
      validação por passo, estado preservado entre passos.
- [ ] `[id]/page.tsx` — tabs:
  - [ ] `Dados` — formulário de edição.
  - [ ] `Endereço` — endereço completo.
  - [ ] `Responsáveis` — legal, almoxarifado, aprovador padrão, notificações.
  - [ ] `Locais de estoque` — lista de `StorageLocation` desta filial.
  - [ ] `Usuários` — memberships da filial (read-only aqui; edição em `/admin/usuarios`).
  - [ ] `Histórico` — `AuditLog` da filial.
- [ ] `page.tsx` de local de estoque: criar/editar local, com tipo, código, responsável.
- [ ] Ações em `src/server/actions/branch.ts` e `src/server/actions/storage-location.ts`,
  com `requirePermission("filial:manage")` / `requirePermission("local:manage")`.
- [ ] `loading.tsx` e `error.tsx` em todas as rotas.

### 04.4 — Primeira filial (bootstrap)

- [ ] Garantir que sempre exista uma filial `MATRIX` (criada no seed da FASE 01).
- [ ] Na tela de filiais, destacar visualmente a matriz (badge) e explicar que ela
      é a sede e tem visão de rede.

### 04.5 — Endereço e mapa (incremento opcional)

- [ ] Botão "usar minha localização" em `/filiais/nova` (preenche lat/lng).
- [ ] Link para abrir o endereço no mapa. **Não** integrar API de mapas nesta fase —
      ícone/link externo basta.

### 04.6 — Consulta de CNPJ (BrasilAPI)

- [x] Botão **"Buscar dados"** ao lado do CNPJ: consulta a BrasilAPI pela rota
      `/api/cnpj/[cnpj]` e preenche razão social, nome fantasia, CNAE, endereço e UF.
      O navegador não fala com a API externa (CSP `connect-src 'self'`).
- [x] A rota exige `filial:create`/`filial:manage`; CNPJ inválido nem é consultado.
- [x] Falha da API externa não trava o cadastro: mostra aviso e mantém o preenchimento
      manual.

## Testes obrigatórios

- [ ] `cnpj` válido/inválido; `zipCode` válido/inválido.
- [ ] `update` grava `AuditLog` com `before` e `after` corretos.
- [ ] `deactivate` é bloqueado com transferência pendente e com inventário aberto.
- [ ] `move` rejeita criar ciclo de hierarquia.
- [ ] `ADMIN_FILIAL` não consegue abrir `[id]` de outra filial
      (`requireBranch` na página e na action).

## Critérios de aceite

- [ ] Cadastro completo salvo e relido sem perda de campo.
- [ ] CNPJ inválido é rejeitado com mensagem clara em português.
- [ ] Filial inativa não aparece nos selects de filial de outros cadastros
      (entradas, transferências, solicitações).
- [ ] Bloqueio de desativação por pendência mostra qual pendência existe.
- [ ] Wizard permite voltar e preservar o preenchimento.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passam.

## Fora do escopo

Importação de filiais em lote (CSV), mapa interativo.
