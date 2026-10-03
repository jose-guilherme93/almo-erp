# almo-erp

Mini ERP de almoxarifado: **estoque**, **solicitação de materiais** e **entrega de materiais**,
organizados em uma **matriz** e **unidades (filiais)** espalhadas por bairros e cidades.

## Estado do projeto

Todas as 14 fases do plano estão implementadas:

| Fase | Entrega |
|---|---|
| 00 | Fundamentos: Next.js 16, Postgres 17, Prisma 7, Tailwind 4 + shadcn, Vitest, Playwright, CI |
| 01 | Modelo de dados completo (15 enums, 28 tabelas) + seed idempotente |
| 02 | Login Google restrito a e-mail corporativo aprovado |
| 03 | RBAC por filial, usuários, papéis e políticas de e-mail |
| 04 | Cadastro completo de unidades e locais de estoque |
| 05 | Catálogo de materiais com leitura de código de barras |
| 06 | Estoque: ledger transacional, saldos, entradas, ajustes e reservas |
| 07 | Transferências entre unidades com recebimento parcial |
| 08 | Solicitações: pedido → aprovação → entrega, com comprovante |
| 09 | Notificações: alerta no dashboard de quem responde |
| 10 | Dashboards por perfil: matriz, unidade e solicitante |
| 11 | Inventário: contagem, divergência e ajuste |
| 12 | Relatórios com exportação CSV |
| 13 | Hardening: auditoria, configurações, cabeçalhos de segurança e manual |

Extras pedidos pela operação, já implementados:

- **PWA instalável** no celular do colaborador (manifesto, service worker, ícones,
  tela cheia). Verificado por teste automatizado: nenhuma tela gera rolagem horizontal
  em 390px.
- **Solicitação sem rascunho**: criar já envia para quem responde.
- **Qualquer unidade** pode ser escolhida ao abrir material ou reparo.
- **A urgência é definida por quem recebe**, não por quem pede.
- **Chamados de reparo** (`/reparos`), com triagem, prioridade, atribuição e conclusão.

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [`AGENTS.md`](./AGENTS.md) | **Comece aqui.** Convenções obrigatórias, regras de ouro, stack e anti-patterns. É o contrato de trabalho do código. |
| [`docs/ARQUITETURA.md`](./docs/ARQUITETURA.md) | Domínio: filial, RBAC, estoque, transferências, solicitações, notificações e rotas. |
| [`docs/MANUAL.md`](./docs/MANUAL.md) | Manual do usuário final, por perfil. |
| [`docs/DECISOES.md`](./docs/DECISOES.md) | Por que cada decisão técnica foi tomada. |
| [`docs/fases/`](./docs/fases/README.md) | O plano de execução, fase por fase. |

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript strict · Auth.js v5 (Google) ·
PostgreSQL 17 · Prisma 7 (driver adapter) · Zod 4 · Tailwind 4 + shadcn/ui ·
Recharts · Vitest + Playwright.

## Como rodar

```bash
# 1. Requisitos
node -v     # v22 LTS
docker -v   # para o Postgres local

# 2. Dependências
pnpm install

# 3. Ambiente
cp .env.example .env
# preencha AUTH_SECRET (openssl rand -base64 32), credenciais do Google e
# AUTH_ALLOWED_DOMAINS com o domínio corporativo

# 4. Banco
docker compose up -d
pnpm db:migrate      # aplica as migrations
pnpm db:seed         # dados de demonstração

# 5. Aplicação
pnpm dev             # http://localhost:3000
```

Com `SEED_ADMIN_EMAIL` preenchido no `.env`, o seed cria o super administrador.

### Usuários de demonstração

Criados pelo seed fora de produção (senha não existe: o login é pelo Google ou,
em testes, pelo provider de credenciais):

| E-mail | Papel | Unidade |
|---|---|---|
| `admin@exemplo.com.br` | SUPER_ADMIN | Matriz |
| `admin.filial@exemplo.com.br` | ADMIN_FILIAL | São Paulo |
| `gestor@exemplo.com.br` | GESTOR | São Paulo |
| `almoxarife@exemplo.com.br` | ALMOXARIFE | São Paulo |
| `solicitante@exemplo.com.br` | SOLICITANTE | São Paulo |
| `consulta@exemplo.com.br` | CONSULTA | Rio de Janeiro |

## Scripts

```bash
pnpm dev            # servidor de desenvolvimento
pnpm build          # build de produção
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit
pnpm test           # Vitest (unitários + integração com banco)
pnpm e2e            # Playwright
pnpm db:migrate     # migrations (dev)
pnpm db:deploy      # migrations (produção)
pnpm db:seed        # seed idempotente
pnpm db:reset       # recria o banco e roda o seed
pnpm db:seed:demo   # dados operacionais de demonstração (estoque, pedidos, transferência)
```

### Explorando sem configurar o Google

Para conhecer o sistema antes de criar as credenciais do Google, ligue
`E2E_AUTH_BYPASS="true"` no `.env` e rode `pnpm db:seed:demo`. A tela de login
passa a mostrar um campo de e-mail: entre com qualquer usuário da tabela abaixo.
Em produção essa opção é recusada na inicialização.

## Deploy (produção)

O guia completo está em [`docs/DEPLOY.md`](docs/DEPLOY.md). Resumo:

- **Uma VPS com Dokploy**: app (build pelo `Dockerfile`) + Postgres como serviço do Dokploy + Traefik.
- No merge da `main`: o **Auto Deploy do Dokploy** builda e sobe (migrations no entrypoint).
- Backup: Dokploy → S3 (principal) + cópia **cifrada** no GitHub Actions (secundária).
- Anexos de imagem ficam no volume (`UPLOAD_DIR=/data/uploads`).
- O E2E é **local** (`E2E_AUTH_BYPASS=true pnpm e2e --project=chromium`); o bypass de
  login de teste é recusado em produção.

## Autenticação no Google

1. Google Cloud Console → **APIs & Services → Credentials** → OAuth 2.0 Client ID (Web).
2. **Authorized redirect URI**: `http://localhost:3000/api/auth/callback/google`
   (e a URI de produção).
3. **Authorized JavaScript origins**: `http://localhost:3000`.
4. Preencha `AUTH_GOOGLE_ID` e `AUTH_GOOGLE_SECRET` no `.env`.

O acesso só é liberado para e-mail de domínio corporativo **e** cadastrado no sistema.
A regra de domínio pode ser ampliada pela tela **Administração → Políticas de e-mail**.

## Segurança

- Autorização no servidor, nunca só no `proxy.ts` (o antigo `middleware.ts`).
- Permissões resolvidas **por filial**: um admin de São Paulo não aprova no Rio.
- Sessão revalidada contra o banco a cada requisição: suspender um usuário vale
  imediatamente.
- Cabeçalhos de segurança (CSP, HSTS, `X-Frame-Options`) em `next.config.ts`.
- Trilha de auditoria append-only em `/admin/auditoria`.
- `E2E_AUTH_BYPASS` (provider de credenciais para testes) é **recusado em produção**
  pelo `src/lib/env.ts`.
