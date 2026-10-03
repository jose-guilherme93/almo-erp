# FASE 13 — Hardening, testes e deploy

> Fechamento do projeto: auditoria real, e2e, performance, segurança e gravação em produção.

## Contexto

Fase de acabamento. O sistema já funciona; aqui ele fica confiável, seguro e pronto para
a operação real do almoxarifado.

## Pré-requisitos

- Fases 00 a 12 concluídas.

## Tarefas

### 13.1 — Auditoria e rastreabilidade

- [ ] `AuditLog` gravado em **toda** ação de escrita de negócio (revisitar e garantir
      cobertura completa: filial, item, solicitação, transferência, inventário, usuário,
      papel, política de e-mail, documento de estoque).
- [ ] Tela `/admin/auditoria` (`papel:manage`): filtros por ator, entidade, filial,
      período, ação; visualização do diff `before`/`after` em JSON formatado.
- [ ] `AuditLog` e `StockLine`/`RequestEvent` **sem** rota de edição ou remoção.
- [ ] `Config` em `/admin/configuracoes` — edição dos parâmetros
      (`sla.approvalHours`, `stock.belowMinDedupDays`, `app.name`, `email.contato`),
      com validação e `AuditLog`.

### 13.2 — Aprovação configurável (incremento do FASE 08)

Implementa o "fluxo configurável por tipo de material" que foi postergado:

- [ ] `Request.approvalLevel` derivado de `Category.requiresApproval` e do valor estimado:
      - [ ] `AUTO` — aprova o `ADMIN_FILIAL`.
      - [ ] `MATRIX` — exige aprovação da matriz (ex.: valor acima do limite ou categoria crítica).
- [ ] `Config.request.matrixApprovalThreshold` (valor em BRL).
- [ ] Segunda etapa de aprovação em `RequestEvent` com `decidedById` da matriz.
- [ ] Notificação `REQUEST_CREATED` também para a matriz quando `approvalLevel = MATRIX`.
- [ ] Tela de aprovação da matriz (`/dashboard` → fila da rede).

### 13.3 — Notificação por e-mail (opcional, depende de SMTP)

Só implementar se houver provedor de e-mail definido.

- [ ] `pnpm add nodemailer` (ou `resend`).
- [ ] `src/server/services/email/` — templates pt-BR para: solicitação recebida,
      aprovada, rejeitada, entregue, transferência enviada/recebida, item abaixo do mínimo.
- [ ] Fila simples em tabela `EmailOutbox` (`status`, `attempts`, `sentAt`, `error`)
      processada por script/cron, **nunca** envio síncrono dentro da request.
- [ ] Preferência por usuário para canal e frequência.

### 13.4 — Segurança

- [ ] `pnpm audit` limpo; `pnpm outdated` revisado.
- [ ] Rate limit em rotas de escrita e na action de login
      (Upstash Redis ou `@upstash/ratelimit`; alternativa: limitador em memória,
      documentando a limitação).
- [ ] CSP estrita via `headers()` no `next.config.ts`
      (`default-src 'self'`; `script-src` com nonce; sem `unsafe-eval` em produção).
- [ ] `images.remotePatterns` restrito aos domínios necessários (Google avatar).
- [ ] Confirmação dupla para ações destrutivas: desativar filial, remover papel,
      cancelar documento já lançado, suspender usuário.
- [ ] Reautenticação para as ações destrutivas acima (revalidar sessão Google).
- [ ] Checagem de header `Host`/`Origin` em Server Actions (proteção contra CSRF).
- [ ] `@zxing/browser` carregado **sob demanda** (dynamic import) para não inflar o bundle.
- [ ] Revisão: nenhuma mensagem de erro vaza stack trace para o usuário
      (`error.tsx` genérico com `requestId`).
- [ ] Revisão de `src/proxy.ts`: confirmar que segue sendo apenas o gate grosso.

### 13.5 — Performance

- [ ] `unstable_cache` / tags do Next para relatórios pesados
      (`revalidateTag("dashboard:matrix")`, `revalidateTag("stock")`).
- [ ] `loading.tsx` e streaming com `Suspense` nas telas lentas (dashboards, relatórios).
- [ ] Verificar ausência de N+1 nos dashboards e relatórios
      (`prisma.$on('query')` em script de desenvolvimento).
- [ ] Índice criado para cada consulta lenta identificada
      (registrar em `docs/ARQUITETURA.md`).
- [ ] Verificação de `bundle` no build; meta: página inicial < 200 kB JS.
- [ ] Imagens e avatares com `next/image`.

### 13.6 — Testes

- [ ] Cobertura de regras de negócio ≥ 85% em `src/server/services/**`.
- [ ] Testes das transições de **todos** os status machines
      (solicitação, transferência, documento, inventário).
- [ ] Teste de integração de escopo: matriz de `role × permission × branch`
      gerada automaticamente a partir de `matrix.ts`.
- [ ] E2E dos fluxos críticos:
  - [ ] `login.spec.ts` (da FASE 02).
  - [ ] `solicitacao-completa.spec.ts`: login → solicitar → aprovar → entregar →
        conferir baixa e comprovante.
  - [ ] `notificacoes.spec.ts` (da FASE 09).
  - [ ] `dashboards.spec.ts` (da FASE 10).
  - [ ] `transferencia.spec.ts`: enviar da matriz, receber na filial, conferir os dois saldos.
  - [ ] `inventario.spec.ts`: contar, divergir, ajustar, conferir saldo.
- [ ] Teste de concorrência no estoque (duas saídas simultâneas não geram saldo negativo).

### 13.7 — Produção

- [ ] Provisionamento: Vercel (app) + Neon/Supabase (Postgres gerenciado).
- [ ] `DATABASE_URL` de produção, `AUTH_SECRET` novo, `AUTH_TRUST_HOST=true`.
- [ ] Migration em produção (`prisma migrate deploy`) via CI/CD, **nunca** `db push`.
- [ ] Domínio próprio + certificado automático.
- [ ] Callback do Google registrado com a URI de produção.
- [ ] DNS do domínio corporativo para a política de e-mail.
- [ ] Dokploy na VPS configurado (decisão final da v1; Vercel/Neon descartados). Ver `docs/DEPLOY.md`.
- [ ] Backup e **teste de restauração** do banco.
- [ ] Monitoramento de uptime e alerta de erro de aplicação.
- [ ] `.env.example` conferido e completo; `.env` fora do repositório.
- [ ] Seed **não** roda em produção.

### 13.8 — Documentação e entrega

- [ ] `README.md` — visão geral, stack, setup, scripts, variáveis de ambiente,
      diagrama de papéis, credenciais de acesso de demonstração.
- [ ] `docs/MANUAL.md` — manual do usuário final, por perfil:
      - [ ] solicitante: como pedir material, acompanhar, cancelar.
      - [ ] gestor/admin de filial: aprovar, entregar, transferir, inventariar.
      - [ ] matriz: dashboards, transferências entre unidades, mínimos, auditoria.
- [ ] `docs/DECISOES.md` — ADRs: por que Auth.js, por que ledger de documentos,
      por que escopo por filial, por que Decimal, por que notificação no banco.
- [ ] `CONTRIBUTING.md` — fluxo de branch, PR, revisão e `AGENTS.md` como referência.
- [ ] Passar por `AGENTS.md` §11 e **remover/não adicionar** nenhum anti-pattern.
- [ ] Revisão final do schema: índice faltando, `onDelete` incorreto, campo órfão.
- [ ] Checklist de lançamento executado e assinado.

## Critérios de aceite (release)

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` verdes.
- [ ] Cobertura de regras de negócio ≥ 85%.
- [ ] Todos os e2e críticos passando no CI.
- [ ] Migration aplicada em produção sem erro e sem perda de dado.
- [ ] Backup testado com restauração bem-sucedida.
- [ ] Fluxo completo de solicitação validado no ar com usuário real.
- [ ] Nenhuma tela quebra em 390px de largura.
- [ ] Documentação completa e atualizada.
- [ ] `pnpm audit` sem vulnerabilidade alta/critical.

## Fora do escopo

App mobile nativo, integração com ERP contábil, portal do fornecedor, compra (cotação,
pedido de compra), integração com leitor fixo/escaneador de serial.
