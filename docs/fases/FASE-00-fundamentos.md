# FASE 00 — Fundamentos e ambiente

> Projeto Next.js rodando localmente, com Postgres, Prisma, lint, tipos e testes verdes.

## Contexto

Começo absoluto do projeto. Nenhuma regra de negócio aqui — apenas a base técnica
sobre a qual todas as fases seguintes vão se apoiar. O repositório hoje contém apenas
documentação (`AGENTS.md` e `docs/`).

## Pré-requisitos

- Node 22 LTS instalado. **Hoje a máquina não tem Node** (`node: command not found`).
  Instale com nvm (`nvm install 22 && nvm use 22`) ou tarball oficial.
- pnpm instalado (`corepack enable && corepack prepare pnpm@latest --activate`).
- Docker disponível (usado só para o Postgres local).

## Tarefas

### 00.1 — Ferramentas base

- [ ] Verificar/instalar Node 22 LTS e pnpm.
- [ ] Inicializar o git se necessário e garantir `.gitignore` cobrindo `node_modules`,
      `.next`, `.env`, `.env.local`, `coverage`, `playwright-report`, `.turbo`.
- [ ] Criar `package.json` com os scripts canônicos de `AGENTS.md` §9.

### 00.2 — Next.js + TypeScript

- [ ] `create-next-app` com TypeScript, App Router, Turbopack, Tailwind 4, ESLint,
      `src/` directory, alias `@/*`.
- [ ] `tsconfig.json` com `strict: true`, `noUncheckedIndexedAccess: true`,
      `noImplicitOverride: true`, `paths: { "@/*": ["./src/*"] }`.
- [ ] Remover o boilerplate de demonstração do App Router.

### 00.3 — Banco de dados local

- [ ] `docker-compose.yml` com serviço `postgres:17`, volume nomeado, porta `5432`,
      healthcheck, variáveis em `.env`.
- [ ] `.env.example` com **todas** as variáveis já previstas no projeto (mesmo as de
      fases futuras, comentadas): `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`,
      `AUTH_GOOGLE_SECRET`, `AUTH_ALLOWED_DOMAINS`, `NEXT_PUBLIC_APP_NAME`,
      `SLA_APPROVAL_HOURS`, `STOCK_BELOW_MIN_DEDUP_DAYS`.
- [ ] `.env` local preenchido com o Compose. Nunca commitar `.env`.
- [ ] Subir o banco e confirmar conexão.

### 00.4 — Prisma

- [ ] `prisma/schema.prisma` inicial (vazio ou com modelo `Config` mínimo só para
      validar o pipeline — o schema real é a FASE 01).
- [ ] `prisma.config.ts` (configuração oficial do Prisma 6) com `datasource` e
      `schema` path corretos.
- [ ] Cliente único em `src/lib/db.ts` com `globalThis` cache em desenvolvimento.
- [ ] Scripts: `db:generate`, `db:migrate`, `db:push`, `db:seed`, `db:studio`.

### 00.5 — UI base

- [ ] shadcn/ui inicializado com Tailwind 4 (`components.json` correto).
- [ ] Adicionar: `button`, `input`, `label`, `select`, `textarea`, `card`, `table`,
      `badge`, `dialog`, `dropdown-menu`, `sheet`, `popover`, `toast` (→ `sonner`),
      `tooltip`, `skeleton`, `alert`, `separator`, `tabs`, `checkbox`, `form`
      (react-hook-form **não** será usado — formulários são Server Actions).
- [ ] Tokens: definir escala de cores e variantes de status (pendente, aprovado, rejeitado,
      em trânsito, entregue) como tokens semânticos do Tailwind, **não** cores soltas.

### 00.6 — Camada base de lib

- [ ] `src/lib/errors.ts` — classes de erro de domínio com mensagem pt-BR.
- [ ] `src/lib/format.ts` — `formatCurrency`, `formatQuantity`, `formatDateTime`,
      `formatDate` com `Intl` e fuso `America/Sao_Paulo`.
- [ ] `src/lib/utils.ts` — `cn()`.
- [ ] `src/lib/action-result.ts` — tipo `ActionResult<T>`.
- [ ] `src/lib/logger.ts` — logger estruturado, substitui `console.log`.
- [ ] `src/lib/validation/` — pasto criado, com o primeiro schema real usado
      (ex.: `auth.ts` com schema de e-mail corporativo).

### 00.7 — Estrutura de rotas vazia

- [ ] Criar os route groups vazios com `loading.tsx` e `error.tsx` modelo:
      `(auth)/`, `(app)/`, e as sub-rotas `dashboard`, `solicitacoes`, `estoque`,
      `transferencias`, `inventario`, `catalogo`, `filiais`, `notificacoes`,
      `relatorios`, `admin`.
- [ ] `(app)/layout.tsx` com guard de sessão **provisório** (retorna a página mesmo
      sem sessão; a real vem na FASE 02) — apenas para validar o shell.

### 00.8 — Qualidade

- [ ] ESLint flat config com regra de fronteira de import (§4 do AGENTS.md)
      implementada via `no-restricted-imports` ou `eslint-plugin-boundaries`.
- [ ] Prettier com `.prettierrc` (semicolon, aspas duplas, printWidth 100).
- [ ] Vitest configurado (`vitest.config.ts`, alias `@/*`, ambiente `node`).
- [ ] Playwright configurado com `webServer` apontando para `pnpm dev`.
- [ ] Husky + lint-staged (`pre-commit`: lint-staged).
- [ ] GitHub Actions `.github/workflows/ci.yml` com lint, typecheck, test, build
      e serviço Postgres.
- [ ] Primeiro teste unitário passando (ex.: `format.test.ts`).

## Modelo de dados

Nenhum modelo de domínio nesta fase. Permitido um `Config` de validação do pipeline.

## Arquivos criados (resumo)

```
package.json  pnpm-lock.yaml  tsconfig.json  next.config.ts  .env.example
.env (gitignored)  docker-compose.yml  components.json
eslint.config.mjs  .prettierrc  vitest.config.ts  playwright.config.ts
prisma/schema.prisma  prisma.config.ts  prisma/seed.ts
.github/workflows/ci.yml
src/lib/{db,errors,format,utils,action-result,logger}.ts
src/lib/validation/auth.ts
src/app/{(auth),(app)}/**
```

## Critérios de aceite

- [ ] `node -v` retorna v22.x e `pnpm -v` funciona.
- [ ] `docker compose up -d` sobe o Postgres e `pnpm prisma db:push` conclui.
- [ ] `pnpm dev` abre a aplicação em `http://localhost:3000` sem erro de hydration.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` passam.
- [ ] `pnpm db:seed` roda sem erro (ainda vazio de domínio).
- [ ] CI verde no PR.
- [ ] Nenhum arquivo `.env` versionado.

## Fora do escopo

Autenticação, RBAC, qualquer entidade de negócio, dashboards.
