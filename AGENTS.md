# AGENTS.md — almoço-erp

> Contrato de trabalho para agentes de IA (e humanos) que implementam este repositório.
> **Leia este arquivo inteiro antes de escrever qualquer código.** Ele tem precedência sobre
> qualquer README, tutorial ou padrão do framework.
>
> **Estado atual do trabalho e pendências vivas: `docs/HANDOFF.md`.** Leia antes de retomar.

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

### 3.10 Autenticação: Google e login local

O acesso tem **duas portas**, ligadas por configuração em `/admin/configuracoes`
(permissão `configuracao:manage`, exclusiva do `SUPER_ADMIN`):

- **Google** (`auth.google.enabled`) — só e-mail de domínio corporativo autorizado
  (`AUTH_ALLOWED_DOMAINS` + `EmailPolicy`) e usuário pré-aprovado. É a porta de
  autoatendimento.
- **Login local** (`auth.localLogin.enabled`) — e-mail + senha. A conta é criada
  por um administrador (ou pelo seed) e **não** passa pela regra de domínio: é o
  caminho para operar o ERP sem Google, inclusive com e-mail pessoal.

A senha é `scrypt` (`src/lib/password.ts`), verificação em tempo constante, e o
provider tem freio de tentativas de força bruta (`src/server/auth/throttle.ts`).
O login local **não** auto-provisiona usuário nem vínculo — quem cria é o
administrador. As regras abaixo continuam valendo integralmente.

No Auth.js **v5** `signIn` **lança** `AuthError` em vez de redirecionar com
`?error=`. Toda action de login precisa traduzir o erro no formato que a tela lê
(`/login?error=<tipo>`); deixar escapar derruba a tela no error boundary.

### 3.11 A interface segue o pensamento, não o roteiro

Regra de produto que vale para **toda** tela:

- **Nada é obrigatório além do estritamente necessário.** Se um campo é opcional
  na regra de negócio, a interface não pode abrir com asterisco nele. Se o
  servidor consegue deduzir, o usuário não digita (SKU gerado, categoria padrão).
- **Não existe caminho onde o usuário precise sair da tela para cumprir um
  pré-requisito do sistema.** Se a ação principal é lançar entrada, o material
  nasce ali. Um cadastro que força o desvio é um cadastro que ninguém preenche.
- **A interface mostra o passo seguinte onde ele falta**, na tela vazia. Não
  existe card de "primeiros passos" nem wizard que obrigue a seguir uma ordem.
- **Papel e permissão não podem travar o trabalho de quem opera.** Quem recebe
  mercadoria precisa poder registrar o material que chega.

Ver `docs/ARQUITETURA.md` §5.1.2 (entrada pela doca) e §9.1 (navegação).

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

O **menu lateral** é outra coisa e segue a ordem do trabalho, não o modelo de dados:
**Ação** (aprovar, entregar, chamados abertos) → **Insumo** (entrada, ajuste, inventário) →
**Consumo** (pedidos) → **Manutenção** (chamados) → **Monitoramento** (saldos, movimentações,
relatórios) → **Configurações** (materiais, unidades, usuários) → **Avançado** (categorias,
unidades de medida, transferências, papéis, políticas de e-mail, auditoria).

Regras do menu: item sem permissão **não aparece**; **transferência só aparece com 2+ unidades
ativas** (numa instalação de uma só não há o que transferir); **nenhum endereço pode aparecer em
dois grupos**; nada de roteiro de "primeiros passos" — a interface mostra o passo seguinte onde
ele falta. Fonte: `src/lib/navigation.ts` e `docs/ARQUITETURA.md` §9.1.

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

> O hook **`pre-push`** (`.husky/pre-push`) roda `lint + typecheck + test + build` antes de
> **todo** push — se algo falhar, o push não sai. Ele exige o Postgres local de pé
> (`docker compose up -d`) e pode ser pulado com `git push --no-verify`, mas **não deve ser**:
> o hook local **é** o portão de qualidade deste projeto (ver §9.2).

Definição de Pronto de uma fase: os comandos acima passam, a fase está marcada como concluída
em `docs/fases/README.md`, e a doc correspondente foi atualizada se houve mudança de regra.

**Ao fechar qualquer mudança de fluxo de usuário, abra o PR e confira o E2E** (§9.4). Ele é a
única camada que prova o caminho de ponta a ponta pela interface; os testes de serviço não
pegam erro de permissão de Server Action, locator quebrado ou ordem de tela.

Cobertura mínima obrigatória de teste:

- Toda função de transição de status (tabela de transições válidas e inválidas).
- Saldo de estoque: entrada, saída, saída sem saldo, reserva, ajuste, transferência
  (ida e volta), inventário com divergência.
- Autorização: matriz de papel × permissão, e negação fora do escopo de filial.
- Regra de e-mail corporativo: domínio permitido, domínio bloqueado, usuário não aprovado.

### 9.1 GitHub Actions — o E2E roda aqui, o resto é à mão

**A qualidade síncrona deste projeto roda local.** O hook `pre-push` (§9) já executa
`lint + typecheck + test + build`, e recusa o push se algo falhar. Isso **não** vai para o GitHub:
repetir localmente o que já passou aqui só consumiria os 2.000 min/mês do plano gratuito, sem
acrescentar nada.

**O E2E é a exceção, e é uma exceção de lugar, não de qualidade.** Rodar a suíte de interface
naquela máquina **derrubou a VPS** — carga 78 em 4 cores, `next dev` com 2,3 GB (39,8% da
máquina) e um Chromium por worker, competindo com os outros usuários do mesmo servidor. Teste de
interface não tem relação com o hardware que serve o ERP.

> Carga descartável e isolada pertence a runner descartável.

Por isso **só o `e2e.yml` roda em pull request.** Os outros são manuais (`workflow_dispatch`) ou
agendados:

| Workflow | Quando roda | Para quê |
|---|---|---|
| `e2e.yml` | **a cada PR** para `develop` e `main` | a prova de ponta a ponta pela interface |
| `release-image.yml` | **a cada tag `v*`** (e à mão, para o preview) | constrói a imagem, publica no GHCR, dispara o deploy e confere que subiu |
| `ci.yml` | à mão | segunda opinião de ambiente (ex.: antes de uma release, ou depois de mexer no Postgres) |
| `backup.yml` | agendado | cópia cifrada do banco para fora da VPS |

Regras que valem para todos:

- **Nenhum job passa de 5 minutos**, com **exceções documentadas**: o `e2e` declara
  `timeout-minutes: 12`; o `release-image` declara 20 (build) e 15 (deploy + conferência), porque
  construir a imagem e esperar a produção subir não cabem em 5 — e são passos que rodam uma vez
  por versão, não a cada PR. Medido no runner: setup **48 s**, warm-up das telas **26 s** e a suíte
  inteira — **103 cenários, todos passando** — em **4,5 min**. O teto do E2E é mais que o dobro do
  medido: é freio, não estimativa.
- **Custo é controlado por gatilho, não por economização.** O E2E dispara em `pull_request`
  (não em `push` livre: empurrar para branch várias vezes estoura a cota), ignora `docs/**` e
  `**.md`, e tem `concurrency` com `cancel-in-progress` — empurrar cinco vezes no mesmo PR
  custa **um** run, não cinco.
- **O runner é fixado (`ubuntu-24.04`), não `ubuntu-latest`.** O rótulo `latest` migra para
  Ubuntu 26 em 19/out/2026, e uma mudança de ambiente não pode chegar de surpresa num workflow que
  publica produção. Trocar de imagem é decisão nossa, testada — não efeito colateral de data.
- **Actions sempre no major atual.** `actions/*` desatualizadas passam a rodar forçadas num Node
  mais novo e emitem aviso de deprecação; o aviso vira quebra quando o runner muda. Conferir o
  major antes de escrever um `uses:` novo (`gh api repos/<org>/<action>/git/matching-refs/tags/v`).
- **O backup secundário se declara não configurado.** Sem os cinco secrets ele **pula com aviso**,
  e o resumo do run diz, em texto, "nenhum backup foi tirado" — em vez de falhar todo dia às 07:00
  e produzir ruído vermelho que ninguém lê. Configurado e quebrado continua falhando alto: a
  distinção é entre *ausência de configuração* e *defeito*. O backup principal é o Dokploy → S3.
- **Deploy não é action.** Publicar é o Dokploy, não o GitHub.
- Antes de adicionar um workflow novo, responder: *isso precisa estar remoto?* Se a resposta é
  não, ele não vai.

**O que não existe, e por quê:** branch protection não está disponível para repositório privado
no GitHub Free (é feature do Pro/Team). Então **nada impede um merge com o E2E vermelho**. O check
aparece no PR — a visibilidade existe; a imposição não. A saída gratuita é mover o portão para
o lado do operador: um script de merge que consulta `gh pr checks` e recusa enquanto não estiver
verde. Pendência conhecida, não omissão.

### 9.2 Release — versão decidida pelo commit, publicada localmente

A versão **nunca é digitada**. Ela é derivada dos commits desde a última tag e publicada por
script local, depois que os gates locais passaram:

```bash
pnpm release:dry      # imprime a decisão — não escreve nada
pnpm release:publish  # grava package.json, commita, tagueia e sobe main + tag
```

- A regra está em `src/lib/release.ts` — **pura e testada** (`release.test.ts`, 25 casos), sem
  git nem I/O. O `scripts/release.mts` só executa a decisão. Erro de regra aparece em unitário,
  não depois da tag publicada.
- `feat:` → **minor** · `fix:`/`perf:`/`refactor:`/`revert:` → **patch** · `!` no tipo ou
  `BREAKING CHANGE:` no corpo → **major** · `docs:`/`chore:`/`test:`/`ci:` → **não publica**.
- Merge é ignorado (é container de operação) e commit fora do formato é ignorado em silêncio:
  falhar o release por causa de commit malformado seria pior do que publicar uma versão a menos.
- **Não cascateia**: o commit de release é `chore`, que não bumpa. Sem isso, cada rodada geraria
  outra tag, para sempre.
- Idempotente: tag existente não faz nada.
- Escape para hotfix pontual: `VERSION=1.2.3 pnpm release:publish`.
- **O `chore(release)` é a única exceção ao PR** (§10.1): ele vai direto na `main` junto com a
  tag. É gerado por script já testado e revisado por humano, então não é o que uma revisão de PR
  acrescentaria — e é ele que dá ao Dokploy o que observar.

### 9.3 Deploy

- **O Dokploy publica por tag.** A tag `vX.Y.Z` é o sinal de deploy; a `main` é a fonte da
  verdade do código. Configuração em `docs/DEPLOY.md`.
- As migrations rodam no **entrypoint** (1 réplica, zero-downtime desligado).
- O portão de qualidade fica **antes** do merge, em duas camadas: os gates locais
  (`pre-push`) são síncronos e imediatos; a prova de ponta a ponta pela interface é o E2E do
  GitHub Actions, que roda no PR (§9.4). O princípio não mudou — o portão é antes do merge, e
  não depois da tag.

### 9.4 E2E — remoto, a cada pull request

- **O E2E roda no GitHub Actions**, a cada PR para `develop` e para `main` (`e2e.yml`). Ele é a
  única camada que prova o caminho de ponta a ponta pela interface: os testes de serviço não pegam
  erro de permissão de Server Action, locator quebrado ou ordem de tela.
- **O motivo é de lugar, não de qualidade.** A máquina de desenvolvimento é uma VPS de 6 GB
  dividida com outros usuários. Rodar a suíte completa ali **derrubou a VPS**: carga 78 em 4
  cores, `next dev` com 2,3 GB e um Chromium por worker. Teste de interface não tem relação com o
  hardware que serve o ERP.
- **O bypass de autenticação de teste só existe fora de produção** (`src/lib/env.ts`), então o E2E
  roda com `pnpm dev` — nunca com `pnpm build && pnpm start`, nem no CI.
- **Localmente, rode um spec de cada vez**, para depurar:

  ```bash
  E2E_AUTH_BYPASS=true pnpm e2e --project=chromium --grep="solicitação"
  ```

  A suíte completa é do runner. `pnpm e2e` sem `--grep` aqui abre vários Chromium ao mesmo tempo
  numa máquina compartilhada — foi exatamente isso que derrubou a VPS.
- **Antes de dar um PR como pronto, confira o check do E2E.** Sem branch protection (§9.1), nada
  impede o merge vermelho: quem lê o PR é quem decide, então ler o check é parte do trabalho.
- **As telas são compiladas antes do primeiro teste** (`e2e/global-setup.ts`). `next dev` compila
  cada rota na primeira visita, e com ~32 telas isso acontece dentro do `expect.timeout` de cada
  teste — lentidão que não é defeito de ninguém e que o `retries` então repete. A lista de telas
  mora em `e2e/helpers/routes.ts` e é a **fonte única**: `mobile.spec.ts` usa o perfil e o rótulo,
  o warm-up usa o caminho.
- **O warm-up aquece por HTTP e em paralelo** (`context.request`, 4 por vez), não abrindo cada
  tela no Chromium. O que compila a rota é a requisição; renderizar e executar o JavaScript dela
  não compila nada a mais. A primeira versão era serial e renderizava — e virou ela mesma o
  gargalo: ~25 s por rota fria, 32 rotas, mais de 10 minutos. Ele **imprime o tempo gasto**, para
  que a próxima estimativa tenha número em vez de achismo.
- **O warm-up depende do cookie da sessão** ser compartilhado entre a página e o `context.request`.
  É o que faz o aquecimento valer: sem sessão, cada requisição é redirecionada para `/login` **sem
  compilar a rota protegida** — o passo existiria, custaria tempo e não aqueceria nada.
- **O warm-up cobre as telas de erro e as de detalhe.** `/forbidden` era compilado frio dentro do
  `expect.timeout` do primeiro teste que o visitava — uma das telas que apareciam como flaky. E as
  telas de detalhe precisam de **id real, lido da listagem**: inventar um id faria a página lançar,
  o funil gravaria a linha, e `erros.spec.ts` (que afirma "Nenhum erro registrado") quebraria por
  causa do aquecimento.
- **Espera por condição, nunca por `networkidle`.** `networkidle` é "500 ms sem tráfego", e num
  `next dev` com HMR, streaming de RSC e SDK de erro isso pode demorar ou não chegar. Os testes
  flaky apareciam em **telas diferentes** a cada execução — sinal de espera indeterminada, não de
  teste defeituoso. O certo é esperar o que se vai medir: o conteúdo principal visível e as fontes
  carregadas.
- **O warm-up não é fatal, mas não pode ser silencioso.** Ele é otimização: se falhar, os testes
  rodam assim mesmo — e o `console.warn` diz que falhou. Um warm-up quebrado derrubou a suíte
  inteira em três execuções, porque o `globalSetup` morria antes de qualquer teste e o sintoma
  ("não cabe no tempo") apontava para o lugar errado.
- **`globalSetup` não herda o `use` da configuração.** `browser.newPage()` sem `baseURL` não
  resolve URL relativa. Qualquer coisa que abra página ali precisa passar o `baseURL` — está em
  `resolveBaseUrl()`.
- **O relatório sobe com `always()`**, nunca `!cancelled()`: quando o job estoura o teto, o
  cancelamento é exatamente quando o relatório mais importa. Perder o diagnóstico foi o pior
  sintoma das primeiras execuções.
- **Quem sobe e quem mata o servidor é o workflow**, não o Playwright. O job não encerrava: depois
  de a suíte terminar (4,5 min, 103 verdes) o passo ficava ~19 min em silêncio e só acabava no teto.
  O log do runner mostrava a causa desde a primeira execução — `Terminate orphan process:
  (next-server)` no fim do job: o servidor sobreviveu ao encerramento do Playwright, e o Playwright
  esperava por ele. Agora o workflow sobe o servidor com `setsid` (sessão própria, para morrer
  inteiro), espera ficar de pé, roda a suíte com `E2E_REUSE_SERVER=true` e mata o que sobrou num
  passo `always()` — que também despeja o log do servidor quando a suíte falha.
  Um job que não encerra é pior que um job lento: o sintoma ("não cabe no tempo") aponta para o
  lugar errado, e eu passei três execuções culpando uma suíte que leva 4,5 min.
- **Números de referência** (medidos, para não virarem lenda): run completo **6,5 min** — servidor
  9 s, suíte **5 min**, encerramento 0 s. Dois testes são flaky e passam no retry; ficam como
  pendência de confiabilidade.
- Cache dos navegadores no runner, `timeout-minutes: 12`, e `concurrency` com
  `cancel-in-progress` para que empurrar de novo não multiplique custo.

### 9.5 Erro é observável, e chega no celular

**Nenhuma rota pode quebrar em silêncio, e nenhum erro pode ficar só no `console` do navegador.**
Tudo que quebra sai pelo funil de incidentes (`src/server/services/observability/`), que entrega o
mesmo evento a vários destinos ao mesmo tempo. `docs/ARQUITETURA.md` §10 tem o desenho.

```
instrumentation ─▶ dispatchIncident ─▶ error-log      (sempre; sem cota; dentro da VPS)
   onRequestError          │         ├▶ better-stack  (SDK do Sentry apontado para o DSN)
   runAction               │         └▶ otel          (pronto, desligado: é o caminho do Grafana)
   process-guards          │
   global-error / error.tsx┘
```

O funil **não conhece os destinos** — por isso trocar de fornecedor, inclusive para um Grafana na
própria VPS, é mudar variável de ambiente e não reescrever instrumentação.

Regras que valem para quem mexer nessa área:

- **`onRequestError` nunca lança.** Se falhar, o Next registra `Error in
  instrumentation.onRequestError` e o erro original se perde.
- **O que fala com Prisma entra por `import()` dinâmico, guardado por
  `NEXT_RUNTIME === "nodejs"`.** `instrumentation.ts` roda na edge também, e a edge não tem Prisma
  nem `node:crypto`. O guard não é preciosismo: é ele que permite ao compilador eliminar o código
  na build da edge. Sem o guard, o bundle da edge carrega o cliente de banco e a aplicação quebra
  ao subir — não no relatório de erro. Confira com `pnpm build`: **zero** aviso de Edge Runtime.
- **Ruído não é erro.** `isIgnorableError` (em `observability/ignorable.ts`) filtra cancelamento
  de navegação. A lista mora num módulo só porque a instrumentação e o gravador consultam a
  mesma — duas listas divergem, e a divergência aparece como erro escondido ou ruído novo.
- **Nunca alargar o filtro.** Um padrão amplo demais esconde o erro que a tela existe para mostrar.
- **Uma linha por erro, não por ocorrência.** Sem `fingerprint`, a tela vira parede. O sino e o
  Telegram vão **só** na primeira ocorrência, e saem do mesmo `outcome` — os três nunca divergem.
- **Credencial e dado pessoal não entram em log.** A régua está em `observability/scrub.ts` e é a
  **única** saída do processo: senha, token, cookie, `authorization`, JWT, CPF, CNPJ e e-mail —
  inclusive em texto solto, onde não há nome de campo para filtrar. Descarta a query string (em
  relatório ela carrega filtro de pessoa). A régua é larga demais de propósito: melhor perder um
  campo útil do que deixar vazar um CPF. Um sink novo que esqueça de chamar `scrubIncident` vaza,
  e a falha só apareceria em produção.
- **Erro de cliente não escreve no banco.** O que vem do navegador é entrada não confiável; o
  relatório vai direto ao destino externo, que tem cota, filtro e `beforeSend`. Gravar no
  `ErrorLog` abriria a tela de observabilidade para injeção de dados falsos.
- **`dispatchIncident` nunca lança.** Destino que falha (rede, cota, credencial) não pode derrubar
  a requisição que já estava falhando.
- **`/admin/erros` avisa por Telegram**, com freio de 15 min por rota+mensagem: erro em laço não
  pode virar 500 mensagens no mesmo chat. O complemento é um monitor externo de uptime em
  `/api/health`, que não exige código.
- **`ErrorLog` tem retenção** (`observability/retention.ts`), sem cron: roda junto com a gravação,
  no máximo uma vez por hora. Só leva o que é resolvido **e** não volta há 90 dias, e um teto
  absoluto corta do mais antigo para o mais novo.

### 9.6 A imagem de produção é construída no CI

**A VPS não builda.** O `release-image.yml` constrói a imagem no runner (4 vCPU, descartável),
publica no GHCR e dispara o deploy; a VPS só **puxa**. Antes o Dokploy clonava o repositório e
rodava `pnpm install && next build` no servidor, competindo com o ERP que já estava no ar.

O deploy é disparado **pelo runner**, e não por webhook, porque o painel do Dokploy vive atrás do
Tailscale: nada na internet o alcança — nem o webhook do GitHub, nem o do Docker Hub. O runner
entra na tailnet como nó efêmero (`tag:ci`) e a ACL limita essa tag a alcançar só o Dokploy.

Regras:

- **Um `NEXT_PUBLIC_*` só é inlinado se o navegador o ler.** Não presuma pelo nome: confira o
  código. Hoje só **`NEXT_PUBLIC_SENTRY_DSN`** é build arg; `NEXT_PUBLIC_GOOGLE_CLIENT_ID` é lido
  num Server Component e passado como prop (runtime), e `NEXT_PUBLIC_APP_URL` / `APP_NAME` não são
  lidos por ninguém. Mudar um build arg exige **imagem nova**, não restart do container.
- **`--build-arg` não declarado é ignorado em silêncio.** O Docker avisa "not consumed", fácil de
  não ver, e o `next build` congela o vazio. Não falha — mente. Todo build arg consumido precisa
  de `ARG` no `Dockerfile`, com comentário dizendo por quê.
- **DSN do Sentry não é segredo.** Ele vai embutido no JavaScript do navegador de qualquer forma,
  então é *variable*, não *secret*. Tratá-lo como segredo dá falsa sensação de proteção.
- **Toda release publica tag imutável** (`vX.Y.Z`) além de `:latest`. Sem a imutável, "voltar para
  a versão de ontem" não tem para onde apontar — o rollback é trocar a tag e deployar (§8 do
  `docs/DEPLOY.md`).
- **O deploy é conferido, não presumido.** O workflow espera `/api/health` responder a versão nova
  e **falha** se não responder. Um deploy que não acontece é o pior defeito possível: foi assim
  que a produção ficou servindo `1.2.0` depois da release da `1.3.0`, sem ninguém perceber.
- **Publicação manual nunca move `latest`** nem dispara deploy. É o caminho do preview (`:edge`).
- **A imagem é `linux/amd64`.** Arm64 exigiria QEMU e multiplicaria o build sem servir a ninguém.

---

## 10. Git

> **Regra que não se negocia: a base é sempre `develop`. `main` nunca recebe push direto.**

### 10.1 Fluxo de trabalho

```
develop ──▶ feat/fase-NN-slug ──PR──▶ [E2E no Actions] ──verde──▶ develop
                                                                     │
                                                        PR de release (uma vez por versão)
                                                                     │
main ◀───────────────────────────────────────────────────────────────┘
   ▲                                                    │
   │                                          pnpm release:publish
   │                                                    │
   └──────────── main volta para develop ────────────────┘
                                                      ↓
                                           tag vX.Y.Z → Dokploy faz deploy
```

O trabalho acontece na `develop`. A `main` recebe código **já verificado**, e só uma vez por
versão. Feature direto para `main` é incomum, e foi por isso que mudou: a verificação saiu do
ambiente de desenvolvimento e foi para o PR, e a `main` deixou de receber PR de feature.

Passos, na ordem:

1. **Nasce da `develop`**, nunca da `main`:
   `git checkout develop && git pull`, depois `git checkout -b feat/fase-NN-slug`.
2. **Trabalha e roda os gates locais** (§9): `lint`, `typecheck`, `test`, `build`, `db:seed`. O
   hook `pre-push` repete os principais no push. **Não** rode a suíte de E2E aqui: ela é remota
   (§9.4), e a máquina não aguenta.
3. **Commita e abre PR para a `develop`.** Com o check do E2E verde, faz o merge.
4. **No release:** abre PR da `develop` para a `main`. Ele também roda o E2E, e é ali que se
   confirma exatamente o que vai virar tag. Merge, e então `pnpm release:publish` — o script
   decide a versão pelos commits (§9.2), grava o `package.json`, cria `chore(release)` e a tag, e
   sobe `main` + tag. É a **única** exceção documentada ao PR: commit gerado por script testado,
   que existe justamente para dar ao Dokploy a tag que dispara o deploy.
5. **`main` volta para `develop`:** `git checkout develop && git merge main` e push. Sem essa
   volta a `develop` envelhece e a base do próximo trabalho fica atrás do que já está em produção.
6. **Apaga a branch de trabalho**, local e remoto (`git branch -d` / `git push origin
   --delete`). Leftover de branch já mergeada é ruído que faz a próxima pessoa achar que existe
   trabalho não publicado.

A `main` **só** recebe merge por PR — **push direto na `main` é erro**, mesmo "já estando tudo
verde" e mesmo em hotfix de uma linha. Sem branch protection (§9.1) isso não é garantido pelo
GitHub: é garantido por este contrato, e por ser o fluxo que o projeto segue.

Antes de apagar qualquer branch, confirme que ela já foi integrada (`git merge-base --is-ancestor
<branch> develop`). Apagar branch com trabalho não mergeado é **perda de código**.

### 10.2 O que o operador não faz

Nada acima exige intervenção humana. O operador **mergeia o PR** (ou pede o merge) e pronto: a
versão, a tag e o deploy seguem sozinhos. Se o `release:publish` falhar, a causa é do lado do
ambiente (cota, rede) e não da regra — a regra em si é testada.

### 10.3 Commits

- Branch por fase: `feat/fase-06-estoque`.
- Conventional Commits: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `build`, `perf`.
  Escopo opcional: `feat(estoque): launch de ajuste com justificativa`.
- **O tipo do commit define a versão** (§9.2): `feat` → minor, `fix`/`perf`/`refactor`/`revert`
  → patch, `docs`/`chore`/`test` → não publica. Escrever o commit no formato **é** o ato de
  release; não existe bump manual de versão.
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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
