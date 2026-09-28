# FASE 03 — RBAC, usuários, convites e papéis

> Permissões corretas, escopo por filial, e administração de usuários e papéis na UI.

## Contexto

Núcleo de segurança do projeto. A partir daqui **toda** ação do sistema passa por
`requirePermission()` + `requireBranch()`. Também é a fase em que o usuário vira
administrador de verdade: ele precisa cadastrar quem trabalha em cada unidade e com
qual papel, sem intervenção de alguém de TI.

## Pré-requisitos

- FASE 02 concluída.
- `docs/ARQUITETURA.md` §3 e §7 lidos.

## Tarefas

### 03.1 — Catálogo de permissões e RBAC

- [ ] `src/lib/permissions/catalog.ts` — **fonte única** de verdade:
  - [ ] Lista de chaves `recurso:acao` (o catálogo completo de `ARQUITETURA.md` §3.3).
  - [ ] `group` de cada permissão para renderizar a tela de papéis agrupada
        (Filiais, Catálogo, Estoque, Solicitações, Transferências, Inventário,
        Relatórios, Administração, Notificações).
  - [ ] `PERMISSIONS_BY_RESOURCE` para validar entrada do usuário.
- [ ] `src/lib/permissions/matrix.ts` — mapa papel padrão → lista de permissões,
  exatamente igual ao seed da FASE 01.
- [ ] `src/lib/permissions/role-permissions.ts`:
  - [ ] `hasPermission(ctx, permission)` — checa `ctx.permissions` (do banco).
  - [ ] `hasAnyPermission`, `hasAllPermissions`.
  - [ ] `isNetworkScope(ctx)` — `scope === ALL_BRANCHES`.
- [ ] `src/lib/guards.ts`:
  - [ ] `requireSession()` — redirect `/login` se não houver sessão válida.
  - [ ] `requirePermission(permission)` — lança `ForbiddenError`; página 403 amigável.
  - [ ] `requireAnyPermission([...])`.
  - [ ] `requireNetworkScope()` — só matriz.
  - [ ] `requireBranch(branchId)` — `ForbiddenError` se `branchId ∉ ctx.branchIds`.
      **Usar em toda ação antes de qualquer query.**
  - [ ] `requireRole([...])` para casos pontuais.
- [ ] `src/lib/scope.ts` — helpers de filtro:
  - [ ] `branchFilter(ctx)` → `{ branchId: { in: ctx.branchIds } }` ou `{}` para rede.
  - [ ] `scopeBranch(ctx, branchId)` → `{ branchId }` já validado (lança se inválido).
  - [ ] `assertBranchAccess(ctx, branchId)`.
  - [ ] `visibleBranchIds(ctx)` — filiais que o usuário pode listar (respeita `active`).
- [ ] `src/app/(app)/forbidden/page.tsx` — 403 amigável.
- [ ] ESLint: regra proibindo `prisma.<model>.findUnique/update/delete` em
      `src/server/**` sem uma chamada de scope na mesma função. Implementar como
      wrapper `src/lib/db/scoped.ts` com métodos tipados que **exigem** `scope`.

### 03.2 — Sessão multi-filial (contexto ativo)

- [ ] `src/lib/active-branch.ts`:
  - [ ] O contexto ativo vem da membership marcada `isDefault` ou do cookie
        `activeBranchId` (validado contra `ctx.branchIds`).
  - [ ] `getActiveBranchId(ctx)`, `setActiveBranchId()` (Server Action).
- [ ] `BranchSwitcher` na topbar: só aparece se `ctx.branchIds.length > 1`.
  Trocar a filial revalida a navegação.
- [ ] Todo cabeçalho/página mostra a filial ativa explicitamente, para o usuário
      nunca confundir em qual unidade está operando.

### 03.3 — Administração de usuários

Rotas em `src/app/(app)/admin/usuarios/`:

- [ ] `page.tsx` — tabela com busca, filtro por filial e por papel, paginação na URL.
      `ADMIN_FILIAL` vê **apenas** os usuários com membership nas suas filiais.
- [ ] `novo/page.tsx` — criar usuário:
  - [ ] e-mail (validar formato + domínio corporativo na mesma função da FASE 02),
        nome, papel, filial(es).
  - [ ] Ação cria `User` (`PENDING` ou `ACTIVE` conforme decisão) + `Membership` +
        `Invite` e dispara a notificação de convite (log por enquanto; a persistência
        real é a FASE 09).
- [ ] `[id]/page.tsx` — detalhe: memberships (papel + filial, adicionar/remover),
      status, suspender/reativar, histórico de atividade recente.
- [ ] Ações (`src/server/actions/usuario.ts`): `criarUsuario`, `atualizarUsuario`,
      `adicionarMembership`, `removerMembership`, `mudarRole`, `suspenderUsuario`,
      `reativarUsuario`, `reenviarConvite`.
  Cada uma: Zod → `requirePermission("usuario:manage")` → `requireBranch` em **cada**
  filial envolvida → service → `AuditLog` → `revalidatePath`.
- [ ] Regra: `SUPER_ADMIN` não pode remover a própria última membership de `SUPER_ADMIN`
      (trava contra lockout). Testar.

### 03.4 — Convites

- [ ] Fluxo: admin cria o convite → `Invite` com `token` e `expiresAt` (7 dias) →
      notificação interna → usuário faz login com o e-mail → `authorize()` encontra o
      `Invite` pendente e aprova automaticamente a membership correspondente.
- [ ] `src/lib/email-policy.ts` já cobre a checagem; integrar no `authorize()` da FASE 02.
- [ ] Convite aceito muda `status` para `ACCEPTED`; revogar marca `REVOKED`.

### 03.5 — Administração de papéis

Rotas em `src/app/(app)/admin/papeis/` (`papel:manage` — só `SUPER_ADMIN`):

- [ ] `page.tsx` — lista de papéis com contagem de usuários e escopo.
- [ ] `[slug]/page.tsx` — editor de permissões agrupadas por recurso, com
      coluna de herança, salvar em uma única Server Action, e diff antes/depois.
- [ ] `novo/page.tsx` — criar papel customizado com `scope` escolhido.
- [ ] Papéis `isSystem` **não podem ser deletados** e não podem mudar `slug` nem `scope`.
- [ ] Ao remover um papel de um usuário, exigir substituição ou confirmar a remoção
      da membership (evita usuário sem acesso).

### 03.6 — Administração de políticas de e-mail

Rotas em `src/app/(app)/admin/politicas-email/` (`politica-email:manage`):

- [ ] CRUD de `EmailPolicy`: domínio, regex (com validação e **teste ao vivo** do regex
      contra um e-mail de exemplo antes de salvar), `autoApprove`, papel padrão,
      filial padrão, ativo.
- [ ] Mostrar quantos usuários e convites foram aprovados por cada política.
- [ ] Aviso visual: a lista de `AUTH_ALLOWED_DOMAINS` do `.env` é somada às políticas;
      explicar isso na tela para o admin não ficar confuso.

## Testes obrigatórios

`src/lib/__tests__/permissions.test.ts`:

- [ ] Matriz papel × permissão confere com `matrix.ts` para os 7 papéis padrão.
- [ ] `hasPermission` falso para papel sem a permissão.

`src/lib/__tests__/guards.test.ts` (com contexto mockado):

- [ ] `requirePermission` lança `ForbiddenError` sem a permissão.
- [ ] `requireBranch` lança para filial fora de `branchIds` e **não** lança para filial válida.
- [ ] `requireBranch` lança para usuário de rede tentando acessar filial inativa.
- [ ] `branchFilter` de rede devolve filtro vazio; de filial devolve filtro por filial.

`src/lib/__tests__/email-policy.test.ts` (estendido):

- [ ] `pattern` de e-mail aprova/recusa usuário real no `authorize()`.

## Critérios de aceite

- [ ] `ADMIN_FILIAL` **não** consegue listar nem editar usuários de outra filial
      (teste de integração, não só visual).
- [ ] `SOLICITANTE` não acessa `/admin/usuarios` (403).
- [ ] `SUPER_ADMIN` não consegue se remover o último papel de si mesmo.
- [ ] Remover uma permissão de um papel reflete no acesso imediatamente.
- [ ] Trocar a filial ativa muda o escopo de todas as listagens na hora.
- [ ] Toda escrita de usuário gera `AuditLog` com `before` e `after`.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passam.

## Fora do escopo

Convite por e-mail com SMTP (sem provedor definido até a FASE 13), SSO por grupo do
Google Workspace, 2FA.
