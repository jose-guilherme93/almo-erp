# FASE 02 — Autenticação Google e regra de e-mail

> Login apenas com e-mail corporativo do Google, e apenas para contas aprovadas no banco.

## Contexto

O usuário pediu: "plataforma logada somente com os emails corporativos do Google. Por
enquanto é só, mas depois pode ser criado users com emails que batem com regras
estabelecidas em middlewares etc."

Esta fase entrega a parte real do "só corporativo" e cria a estrutura
(`EmailPolicy`) que suporta as regras avançadas sem implementar a complexidade agora.

## Pré-requisitos

- FASE 01 concluída (modelos `User`, `EmailPolicy`, `Invite`, `Membership`, `Role`).
- Credenciais OAuth do Google Cloud:
  - **Client ID** e **Client Secret** de um app Web (Google Cloud Console → APIs & Services → Credentials).
  - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
    (e a URI de produção, ex.: `https://almo-erp.vercel.app/api/auth/callback/google`).
  - Authorized JavaScript origins: `http://localhost:3000` e o domínio de produção.
  - Consent screen do tipo **Internal** (restrito ao Workspace) ou **External** com
    e-mail corporativo verificado.
- Criar a `AUTH_SECRET` com `openssl rand -base64 32`.

## Tarefas

### 02.1 — Dependências e config

- [ ] `pnpm add next-auth@beta@5` (Auth.js v5) e o provider Google (já incluso).
- [ ] `pnpm add @auth/prisma-adapter` + `pnpm add -D @auth/core` (adapter de sessão
      com Prisma, caso opte por sessão persistida em banco).
- [ ] `auth.config.ts` na raiz (config sem `prisma`, para uso no edge/middleware).
- [ ] `src/lib/auth.ts` — `NextAuth()` completo, estendendo com o `authorize` do provider
      Google e o `adapter` do Prisma.
- [ ] `src/app/api/auth/[...nextauth]/route.ts` exportando os handlers.
- [ ] `.env` com `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
      `AUTH_ALLOWED_DOMAINS=exemplo.com.br`, `AUTH_TRUST_HOST=true`.

### 02.2 — `authorize()` — a regra de e-mail

- [ ] `src/lib/email-policy.ts` exportando funções **puras e testáveis** (sem I/O):
  - [ ] `normalizeEmail(email)` — trim + minúsculas.
  - [ ] `extractDomain(email)` — parte após `@`, validada.
  - [ ] `isValidEmailShape(email)`.
  - [ ] `isCorporateDomain(domain, envDomains, policies)` — `true` se o domínio está
        em `AUTH_ALLOWED_DOMAINS` (env) **ou** em `EmailPolicy` ativa.
  - [ ] `matchesEmailPattern(email, pattern)` — valida e aplica a regex de `EmailPolicy.pattern`.
- [ ] No `authorize()` do provider Google, **nesta ordem exata**:
  1. Validar formato do e-mail. Falhou → `null` (a UI mostra `/acesso-negado`).
  2. `hd` do token, se presente, deve casar com o domínio esperado. Não confie nele
     como autorização — é só um sinal.
  3. Consultar `EmailPolicy` ativa para o domínio.
  4. Se `pattern` existir e não casar → negar.
  5. Se não for domínio corporativo → negar com motivo `domain-not-allowed`.
  6. Buscar `User` por e-mail:
     - `ACTIVE` → permitido.
     - `PENDING` → negar com motivo `pending-approval` (exibe tela de aguardo).
     - `SUSPENDED` / `INACTIVE` → negar com motivo `suspended`.
     - não existe:
       - se a `EmailPolicy.autoApprove` for `true` → criar `User` `ACTIVE`, criar
         `Membership` com o papel padrão na filial padrão, notificar
         `ACCESS_GRANTED` (notificação real na FASE 09; por enquanto apenas `console`
         via logger estruturado, e **não** quebrar o login).
       - se `autoApprove` for `false` (ou não houver policy) → criar `User` `PENDING` +
         `Invite` e **negar o acesso** com motivo `awaiting-approval`.
- [ ] O motivo da negativa vai para a sessão como `?erro=<motivo>` (via `redirectTo`),
  para a tela explicar exatamente o que aconteceu.

### 02.3 — Sessão e contexto

- [ ] Callbacks do Auth.js:
  - [ ] `jwt`: colocar no token apenas `userId` e `status` (mínimo necessário).
        **Nunca** colocar permissões ou lista de filiais no token (fica desatualizado).
  - [ ] `session`: expor `session.user.id` e `session.user.status`.
- [ ] `src/lib/auth-context.ts` — `getAuthContext()`:
  - [ ] Lê a sessão.
  - [ ] Relê `User` + `Membership` (+ roles e permissões) **do banco**, sempre.
  - [ ] Retorna `{ user, memberships, branchIds, permissions, scope }`.
  - [ ] Cache por request com `React.cache()`.
  - [ ] Se `status !== ACTIVE` → `null` (sessão inválida de fato).
- [ ] `requireSession()` e `requirePermission()` (stubs que lançam `ForbiddenError`/`redirect`)
  já no lugar — a matriz completa de permissões é da FASE 03.
- [ ] `signOut` com redirect para `/login`.

### 02.4 — Middleware (gate grosso apenas)

- [ ] `src/middleware.ts`:
  - [ ] `matcher` cobrindo todas as rotas de `(app)` **exceto** `/login`, `/acesso-negado`,
        `/api/auth/*` e assets.
  - [ ] Sem sessão → `redirect("/login?callbackUrl=...")`.
  - [ ] Com sessão, seguir normalmente. **Nenhuma decisão de permissão aqui** —
        ver `AGENTS.md` §3.1.
  - [ ] Comentário no arquivo explicando por que a autorização real não mora aqui.

### 02.5 — Telas de autenticação

- [ ] `src/app/(auth)/layout.tsx` — layout limpo, centralizado, com identidade visual.
- [ ] `src/app/(auth)/login/page.tsx`:
  - [ ] Botão único "Entrar com Google" (provider único, sem senha).
  - [ ] Explicação visível: "acesso restrito a e-mails corporativos".
  - [ ] Tratamento de erro por search param com mensagem específica
        (`domain-not-allowed`, `awaiting-approval`, `pending-approval`, `suspended`,
        `access-denied`).
  - [ ] `loading.tsx` e `error.tsx`.
- [ ] `src/app/(auth)/acesso-negado/page.tsx` — o que aconteceu, o que fazer,
      e-mail de contato do administrador lido de `Config`.
- [ ] Callback de sucesso: redirect para `callbackUrl` ou, por padrão, `/meu`.
  (O roteamento por papel acontece na FASE 03.)

### 02.6 — Primeiro smoke test

- [ ] Com a sessão ativa, criar `src/app/(app)/layout.tsx` que chama `requireSession()`
      e exibe nome/email do usuário logado.
- [ ] Acessar uma rota de `(app)` sem sessão deve redirecionar para `/login`.

## Testes obrigatórios

`src/lib/__tests__/email-policy.test.ts` (funções puras, sem banco):

- [ ] Domínio permitido via `EmailPolicy` → `true`.
- [ ] Domínio permitido via `AUTH_ALLOWED_DOMAINS` → `true`.
- [ ] Gmail/Hotmail pessoal → `false`.
- [ ] Domínio não permitido → `false`.
- [ ] `pattern` de `EmailPolicy` casando → `true`; não casando → `false`.
- [ ] E-mail malformado, sem `@`, com espaço → `false`.
- [ ] `normalizeEmail` com maiúsculas/espaços.
- [ ] `extractDomain` de e-mail inválido.

`e2e/auth.spec.ts`:

- [ ] Rota protegida sem sessão → redirect para `/login`.
- [ ] `/login` renderiza o botão do Google.
- [ ] Página de acesso negado com motivo renderizado a partir da query.

## Critérios de aceite

- [ ] `pnpm dev` + login real com um e-mail corporativo aprovado → entra no app.
- [ ] Login com e-mail pessoal (gmail.com) → acesso negado, sem stack trace no usuário.
- [ ] Login com e-mail corporativo **não** cadastrado e `autoApprove=false` → usuário
      `PENDING` criado, `Invite` criado, acesso negado.
- [ ] Suspender o `User` no banco derruba o acesso no próximo request.
- [ ] `AUTH_SECRET`, `AUTH_GOOGLE_SECRET` fora do git (`git grep` confirma).
- [ ] Middleware **não** contém nenhuma checagem de role/permission.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passam.

## Fora do escopo

Telas de usuários/papéis (FASE 03), edição de `EmailPolicy` na UI (FASE 03),
self-service de recuperação de senha, SSO por grupo do Google Workspace.
