# AGENTS.md — almoço-erp

> Contrato de trabalho para agentes de IA (e humanos) que implementam este repositório.
> **Leia este arquivo inteiro antes de escrever qualquer código.** Ele tem precedência sobre
> qualquer README, tutorial ou padrão do framework.

---

## 1. O que é este projeto

`almo-erp` é um mini ERP de almoxarifado que resolve três problemas:

1. **Estoque** — controle de saldos, entradas, saídas, ajustes, transferências e inventário.
2. **Solicitação de materiais** — fluxo de pedido → aprovação → entrega, com trilha de auditoria.
3. **Entrega de materiais** — separação, conferência, baixa de estoque e comprovante de recebimento.

A operação tem uma **matriz** e **unidades (filiais)** espalhadas por bairros e cidades.
Cada unidade tem seu próprio almoxarifado, seus próprios usuários e seus próprios aprovadores.

### Idiomas

| Camada | Idioma |
|---|---|
| Identificadores de código (TS, componentes, funções) | **inglês** |
| Nomes de tabelas/colunas/enums no banco | **inglês** (`snake_case`, enums `SCREAMING_SNAKE`) |
| Texto visível na UI, rotas, e termos de domínio | **português do Brasil** |
| Comentários de código | **português**, apenas para regra de negócio não óbvia |

`Item` (código) = "material" (na UI). `Branch` = "filial"/"unidade" (na UI).
`Request` = "solicitação" (material). `MaintenanceRequest` = "chamado" (reparo ou TI).
`Delegation` = "encaminhamento" (etapa de uma demanda em outro setor).
`Sector` = "setor" (Financeiro, Pedagógico, RH, Almoxarifado, Manutenção, TI).
`StockDocument` = "movimentação de estoque".

**Todo usuário é solicitante.** Um usuário novo nasce `SOLICITANTE` e enxerga
apenas o que ele mesmo pediu. Ver mais do que isso é uma permissão explícita
(`solicitacao:overview` / `manutencao:overview`), nunca o padrão.

---

## 2. Stack (fixada — não troque sem atualizar este arquivo)

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack, Server Actions) |
| Linguagem | TypeScript 5.x, `strict: true` |
| Runtime | Node 22 LTS, pnpm |
| Autenticação | Auth.js v5 (NextAuth) — provider **Google** |
| Banco | PostgreSQL 17 |
| ORM | Prisma 6 |
| Validação | Zod 4 |
| UI | Tailwind CSS 4 + shadcn/ui + Radix UI |
| Gráficos | Recharts |
| Leitura de código de barras | `@zxing/browser` |
| Tabelas | Server Components com filtros/paginação na URL (sem biblioteca de tabela) |
| Testes | Vitest (regras de negócio) + Playwright (fluxos críticos) |
| Qualidade | ESLint (flat) + Prettier + Husky + lint-staged |

**Antes da FASE 00**, se `node -v` falhar, instale o Node 22 LTS (nvm ou tarball oficial).
`docker` é usado apenas para o Postgres local — não use Docker para o app.

---

## 3. Regras de ouro (nunca violar)

### 3.1 Autorização mora no servidor, nunca só na borda

Existe um advisory de segurança do Next.js (jul/2026) sobre *bypass* de middleware.
Portanto:

- `src/proxy.ts` (convenção do Next 16; substituiu `middleware.ts`) faz **apenas** o
  gate grosso: existe sessão? Se não, redirect para `/login`. Nada além disso.
- **Toda** Server Action e **todo** Route Handler chama, na primeira linha útil:

  ```ts
  await requirePermission("solicitacao:approve")
  await requireBranch(branchId)   // valida que o usuário tem acesso a ESTA filial
  ```

- **Nunca** confie em `branchId` vindo de search params, form data ou rota.
- **Nunca** confie em role/permission vindo do JWT para decisão de negócio.
  O JWT serve só para "tem sessão"; a autorização real lê o banco.

### 3.2 Toda query de negócio é filtrada por filial

```ts
// ERRADO
await prisma.request.findUnique({ where: { id } })

// CERTO
await prisma.request.findFirst({
  where: { id, branchId: { in: ctx.branchIds } },
})
```

Use sempre o helper `scopeBranch()` de `src/lib/scope.ts`. Ele é a barreira anti-vazamento
entre filiais. **Nunca** faça `findUnique` em entidade de negócio sem checar filial antes.

### 3.3 O estoque tem uma verdade e um caminho

- `StockLevel` é **cache** (saldo materializado por item + local).
- `StockDocument` + `StockLine` são a **verdade**: ledger append-only, nunca UPDATE nem DELETE.
- Toda alteração de saldo nasce de um `StockDocument`, dentro de uma transação,
  com `SELECT ... FOR UPDATE` no `StockLevel` (Prisma: `prisma.$queryRaw` com `FOR UPDATE`,
  ou lock otimista via coluna `version` — escolha uma e aplique em todo o projeto).
- **Saldo negativo é proibido.** Valide antes de gravar e lance ajuste se necessário.
- Lote/validade: se `Item.controlledByLot`, a linha do documento exige `lotId` válido e não vencido.

### 3.4 Máquina de estados é explícita

Todo status vive em enum Prisma e muda **exclusivamente** por uma função de transição
(`src/server/services/<dominio>/transitions.ts`). Nunca `update({ status })` direto de fora.
Transições inválidas lançam `InvalidTransitionError` (mapped para mensagem de UI amigável).

### 3.5 Números são Decimal, nunca float

Dinheiro (`unitPrice`, `totalCost`) e quantidade (`quantity`) usam `Decimal` do Prisma.
Formatação só na borda: `Intl.NumberFormat('pt-BR', { currency: 'BRL' })`.
Proibido `parseFloat`, `toFixed` em regra de negócio, `+`/`-` com `number` em cálculo monetário.

### 3.6 Evento de domínio vira notificação

Toda transição de status relevante **cria notificações** na mesma transação, via
`src/server/services/notificacao/notify.ts`. Quem recebe é sempre resolvido por regra
explícita (ver `docs/ARQUITETURA.md` §7). **Nunca** "depois a gente notifica".

### 3.7 A urgência é de quem recebe, a unidade é de quem pede

Duas regras de produto que valem para **toda** solicitação (material ou reparo):

- **Quem pede não define prioridade.** A solicitação nasce `NORMAL` e sem classificação
  no reparo; quem decide é o responsável que recebe, porque é ele quem conhece a fila e
  o estoque do momento. Não adicione seletor de urgência no formulário de abertura.
- **Quem pede escolhe a unidade**, entre todas as ativas — não apenas as do seu vínculo.
  O colaborador pode estar em outra unidade. Quem resolve é quem recebe lá.

Exceção consciente ao escopo por filial: a **abertura** aceita qualquer unidade ativa
(§3.2 continua valendo para leitura, edição e aprovação). O solicitante sempre enxerga o
que ele mesmo pediu, mesmo que tenha escolhido outra unidade.

### 3.8 Criar já é enviar

Solicitação de material e chamado de reparo **não têm rascunho**: nascem na fila de quem
responde, já com o evento e a notificação. Não existe botão "enviar para aprovação" —
pedir é um ato, não um rascunho.

### 3.9 Não invente requisitos

Se algo não está neste repositório (`AGENTS.md`, `docs/`, `docs/fases/`), **pergunte** —
não invente regra de negócio. Se implementou algo, atualize a doc no mesmo commit.

---

## 4. Estrutura de pastas

```
almo-erp/
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  └─ seed.ts
├─ src/
│  ├─ proxy.ts                 # gate grosso de sessão (ex-middleware.ts)
│  ├─ app/
│  │  ├─ (auth)/               # login, acesso-negado (sem layout autenticado)
│  │  ├─ (app)/                # área logada, com shell + guard de sessão
│  │  │  ├─ dashboard/         # dashboards por perfil (ver §7)
│  │  │  ├─ solicitacoes/      # nova, listar, [id], aprovar
│  │  │  ├─ entregas/
│  │  │  ├─ encaminhamentos/   # etapas de demanda em outros setores
│  │  │  ├─ estoque/           # saldos, movimentacoes, entradas, ajustes
│  │  │  ├─ transferencias/
│  │  │  ├─ inventario/
│  │  │  ├─ catalogo/          # itens, categorias, unidades
│  │  │  ├─ filiais/           # cadastro completo
│  │  │  ├─ notificacoes/
│  │  │  ├─ relatorios/
│  │  │  └─ admin/             # usuarios, papeis, politicas-email
│  │  └─ api/auth/[...nextauth]/
│  ├─ components/
│  │  ├─ ui/                   # shadcn (não editar sem necessidade)
│  │  ├─ layout/               # shell, sidebar, topbar
│  │  ├─ data-table/           # tabela com filtros na URL
│  │  ├─ domain/               # componentes de negócio
│  │  └─ charts/
│  ├─ lib/
│  │  ├─ db.ts  auth.ts  permissions.ts  scope.ts
│  │  ├─ email-policy.ts  errors.ts  utils.ts  format.ts
│  │  └─ validation/           # um schema Zod por entidade
│  └─ server/
│     ├─ actions/              # uma pasta por entidade
│     └─ services/             # regras de negócio (não importar Prisma direto de actions)
├─ docs/
│  ├─ ARQUITETURA.md
│  └─ fases/                   # um arquivo por fase
└─ AGENTS.md
```

**Limites de import (respeite, o ESLint deve reforçar):**

```
app/*        →  pode importar lib, server, components
server/*     →  pode importar lib; NUNCA importar app/ nem components/
lib/*        →  NÃO importa server/* nem app/*
components/* →  pode importar lib; NÃO importa server/* (só tipos e actions client)
```

Componentes cliente **nunca** importam Prisma. Dados de servidor chegam por Server Component
ou por Server Action.

---

## 5. Convenções de código

- **Server Component por padrão.** `"use client"` só para: input interativo, tabela com
  ordenação local, modal, menu, contador de notificação, canvas de leitura de código de barras.
- **Dados de servidor nunca no `useState`.** Busca no Server Component, muta por Server Action,
  revalida com `revalidatePath`.
- **Filtros, paginação e ordenação moram na URL** (`nuqs` / `searchParams`), não em estado local.
  Isso torna toda tela compartilhável e o back do navegador correto.
- **Server Actions**: um arquivo por entidade em `src/server/actions/`, cada `action` =
  `Zod.safeParse` → `requirePermission` → `service` → `revalidatePath` → `ActionResult`.
  Retorne sempre o tipo `ActionResult<T> = { ok: true, data: T } | { ok: false, error: string, fieldErrors? }`.
- **Erros de domínio** em `src/lib/errors.ts` (`InvalidTransitionError`, `InsufficientStockError`,
  `ForbiddenError`, `NotFoundError`), com mensagem pt-BR pronta para UI.
- **Sem `any`.** `strict: true` + `noUncheckedIndexedAccess: true`. Unknown → type guard.
- **Status como union type derivado do enum Prisma** (`$Enums.RequestStatus`), nunca string solta.
- **Datas**: `DateTime` no banco, formato pt-BR só na apresentação. Fuso: tudo em UTC, exiba em
  `America/Sao_Paulo`.
- **Valores de domínio**: enums Prisma para status/prioridade; tabelas de lookup para
  `Category`, `Unit`, `StorageLocation`, `Role`.
- **Nomes de arquivo**: `kebab-case.pt-BR.ts` no domínio (`nova-solicitacao-form.tsx`),
  `kebab-case.ts` em infra (`email-policy.ts`).
- **Comentários explicam o porquê**, nunca o óbvio. Nenhum comentário de código morto.
- **Sem `console.log`** em código de produção — use o logger estruturado.

---

## 6. Convenções de UI

- shadcn/ui como base. **Não** instalar biblioteca de componente que já exista no `ui/`.
- Toda tela de listagem: busca, filtros, ordenação, paginação e estado vazio tratados.
- Toda rota da `(app)` precisa de `loading.tsx` e `error.tsx`.
- Formulário: Server Action + `useActionState`, validação Zod espelhada no client,
  erros por campo, botão com estado de loading, e `aria-*` nos campos.
- Feedback de sucesso/erro via `sonner`.
- Layout responsivo obrigatório (o almoxarife usa celular/tablet no balcão).
- Paleta e tokens: usar as variáveis do Tailwind do projeto. Sem cores hardcoded.
- Acessibilidade: labels associados, foco visível, navegação por teclado nas tabelas e modais.

---

## 7. Dashboards e responsabilidades (regra do projeto)

Existem **três** dashboards, com audiência distinta. **Não misture.**

| Rota | Quem entra | Conteúdo |
|---|---|---|
| `/dashboard` | `SUPER_ADMIN`, `ADMIN_MATRIZ` | consolidado de **todas** as filiais: valor de estoque, itens abaixo do mínimo, solicitações pendentes em toda a rede, transferências em trânsito, gráficos de entradas × saídas, ranking de consumo |
| `/dashboard/unidades` | `SUPER_ADMIN`, `ADMIN_MATRIZ` | uma linha por filial com seus KPIs; drill para o dashboard da unidade |
| `/dashboard/unidade/[branchId]` | `ADMIN_FILIAL` (apenas a sua), `SUPER_ADMIN`, `ADMIN_MATRIZ` | fila de chamados da filial, pedidos aguardando aprovação, entregas pendentes, inventário em aberto, indicadores da filial |
| `/meu` | qualquer usuário logado | minhas solicitações, status, histórico de entregas, perfil |

Regras:

- O dashboard de **filial é exclusivo do admin da unidade** (e da matriz, em modo leitura).
  Um `SOLICITANTE` ou `GESTOR` sem papel de admin **não tem** dashboard de unidade.
- A **notificação de nova solicitação aparece no topo do dashboard de quem responde** —
  ou seja, o `ADMIN_FILIAL` / `GESTOR` responsável por aprovar naquela filial.
- O solicitante nunca vê dashboard administrativo. Ele usa `/solicitacoes/nova` e `/meu`.
- Contadores do dashboard e do sino de notificações **sempre vêm do mesmo cálculo** —
  uma única função de agregação, para nunca divergirem.

---

## 8. Notificações

- `Notification` é persistida no banco (não é e-mail, não é push).
- Criada **na mesma transação** da transição de status que a originou.
- Tipos (`NotificationType`): `REQUEST_CREATED`, `REQUEST_CLAIMED`, `REQUEST_APPROVED`,
  `REQUEST_PARTIALLY_APPROVED`, `REQUEST_REJECTED`, `REQUEST_DELIVERED`,
  `TRANSFER_SENT`, `TRANSFER_RECEIVED`, `STOCK_BELOW_MIN`, `INVENTORY_DIVERGENCE`,
  `ACCESS_REQUESTED`, `ACCESS_GRANTED`, `MAINTENANCE_CREATED`, `MAINTENANCE_ASSIGNED`,
  `MAINTENANCE_PRIORITY_SET`, `MAINTENANCE_DONE`, `DELEGATION_REQUESTED`,
  `DELEGATION_ACCEPTED`, `DELEGATION_COMPLETED`, `DELEGATION_RETURNED`.
- Cada notificação guarda `actorId` (quem disparou), `entityType`, `entityId`, `branchId`,
  `title`, `body`, `link`, `readAt`, `createdAt`.
- A caixa de entrada fica em `/notificacoes`; o sino na topbar mostra o total não lidas.
- Marcar como lida é idempotente e acontece ao abrir a tela de destino da notificação
  (e também tem ação explícita "marcar todas como lidas").
- Fan-out resolvido por `resolveRecipients()` em um único lugar, com regra testada por tipo.

---

## 9. Qualidade — comandos obrigatórios

Toda fase termina com, **na ordem**, tudo passando:

```bash
pnpm lint            # ESLint
pnpm typecheck       # tsc --noEmit
pnpm test            # Vitest (regras de negócio)
pnpm build           # build de produção
pnpm db:seed         # seed idempotente
```

Definição de Pronto de uma fase: os comandos acima passam, a fase está marcada como concluída
em `docs/fases/README.md`, e a doc correspondente foi atualizada se houve mudança de regra.

Cobertura mínima obrigatória de teste:

- Toda função de transição de status (tabela de transições válidas e inválidas).
- Saldo de estoque: entrada, saída, saída sem saldo, reserva, ajuste, transferência
  (ida e volta), inventário com divergência.
- Autorização: matriz de papel × permissão, e negação fora do escopo de filial.
- Regra de e-mail corporativo: domínio permitido, domínio bloqueado, usuário não aprovado.

### 9.1 CI (GitHub Actions)

- **Só `main` dispara CI.** Pushes em `develop` ou em branches de trabalho não rodam
  Actions. O PR para `main` roda o job de qualidade.
- **Nenhum job passa de 5 minutos.** Todo job declara `timeout-minutes: 5` (e as etapas
  pesadas, teto próprio). Um job que estouraria o teto deve **falhar rápido**, nunca
  pendurar meia hora.
- O CI automático (`ci.yml`) é só: install, lint, typecheck, migrations, seed, test e build.
- **E2E é manual** (`e2e.yml`, `workflow_dispatch`), também com teto de 5 minutos e cache
  dos navegadores. Não roda em push nem em PR.

---

## 10. Git

- Branch por fase: `feat/fase-06-estoque`.
- Conventional Commits: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build`, `perf`.
  Escopo opcional: `feat(estoque): launch de ajuste com justificativa`.
- PR por fase, com a lista de critérios de aceite da fase como checklist.
- Migration Prisma sempre versionada e revisada — nunca edite migration já aplicada.

---

## 11. Anti-patterns (nunca fazer)

- `findUnique` de entidade de negócio sem filtro de filial.
- Autorizar só pelo `proxy.ts` (antigo `middleware.ts`).
- `update` ou `delete` em `StockDocument`/`StockLine`.
- Saldo de estoque negativo.
- `any`, `@ts-ignore`, `as unknown as`.
- Números de dinheiro/quantidade em `number`.
- Prisma importado dentro de componente cliente.
- Estado local duplicando dado vindo do servidor.
- Tela sem estado vazio / loading / erro.
- Criar biblioteca nova para algo que shadcn ou o Next já resolvem.
- Implementar uma fase sem ler o arquivo da fase em `docs/fases/`.
- Mexer em fase futura "adiantando" — respeite a ordem das fases.
