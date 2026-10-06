# FASE 20 — Observabilidade de erro no servidor

> Um teste real em produção mostrou a lacuna: um erro de rota só existia como
> linha no stdout do container, sem busca e sem alerta. O usuário via
> `Referência: abc123` na tela e **ninguém conseguia descobrir o que aconteceu**.
> Auditoria responde "quem fez o quê"; não responde "quebrou alguma coisa?".

## Contexto

O caminho de suporte hoje é o pior possível: o usuário relata um código que o
servidor imprimiu num log que ninguém lê. Esta fase fecha o ciclo sem serviço
novo, sem custo e sem sair do produto — como combinado: a observabilidade fica
**dentro do ERP**, e o operador não precisa operar nada.

A peça que torna isso possível é o gancho `onRequestError` do Next 16: ele
entrega todo erro de render, route e action **com o `digest`** — o mesmo código
que aparece na tela do usuário.

## Tarefas

- [x] `ErrorLog` no schema + migration `20261006123750_erro_de_servidor_observavel`.
      Uma linha por erro **único**: `fingerprint` único (rota sem query + digest +
      mensagem normalizada), `count`, `firstSeenAt`/`lastSeenAt`, `resolvedAt`,
      `appVersion`.
- [x] `NotificationType.ERROR_REPORTED`.
- [x] `src/server/services/error-log.ts`: `recordServerError`, `fingerprintOf`,
      `normalizeMessage`, `normalizeRoutePath`, `isIgnorableError`, listagem,
      resolução e reabertura.
- [x] `src/instrumentation.ts` com `onRequestError`. Import dinâmico do serviço,
      guardado por `NEXT_RUNTIME === "nodejs"` (a edge não tem Prisma), e nunca
      lança.
- [x] `src/server/services/error-log-alert.ts`: notifica **só na primeira
      ocorrência** do fingerprint.
- [x] Fan-out `ERROR_REPORTED` → quem tem `papel:manage`.
- [x] Tela `/admin/erros` no padrão da `/admin/auditoria`, com busca por digest,
      filtro por rota e de situação, e "marcar como resolvido".
- [x] Ações `resolverErroAction` / `reabrirErroAction`.
- [x] Item no menu (Avançado), mesma permissão de `/admin/auditoria`.
- [x] `docs/ARQUITETURA.md` §10.1 e `AGENTS.md` §9.5.
- [x] E2E `e2e/erros.spec.ts`; unitários em `error-log.test.ts` (34 casos).

## Achado durante a execução

Rodar de verdade — e não só testar — expôs duas coisas que nenhum teste unitário
teria pego:

1. **Ruído do Next.** `The destination stream closed early.` aparece quando uma
   navegação RSC é abandonada (o usuário clica em outro link antes do stream
   terminar). É comportamento normal, chega em volume alto e **enchia a tela**,
   escondendo o erro que importa. Virou `isIgnorableError`, com lista curta e
   específica de propósito.
2. **Query string na rota.** O Next anexa `?_rsc=<hash>` a cada navegação, e o
   hash muda sempre. Sem `normalizeRoutePath`, a mesma tela viraria uma linha
   nova por visita — o oposto de deduplicar.

## Verificação ponta a ponta

Com erro proposital contra o servidor de desenvolvimento:

- 3 requisições com falha → 3 respostas 500
- **1 linha** na tabela, com `3x`
- busca pelo digest devolve a linha
- **1 notificação** no sino para os 3 erros

## Fora do escopo

- Erro de JavaScript no cliente (tela branca, falha de hidratação): exigiria
  entrada não confiável no banco, com Zod, limite de tamanho e trava anti-loop.
- Log de uso / navegação — é trabalho de analytics, não de tabela no Postgres.
- Alerta por e-mail (o produto não tem SMTP) e monitor externo de uptime.
  `/admin/erros` é **reativa**: não avisa sozinha.

## Critérios de aceite

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` (434), `pnpm build`, `pnpm db:seed`.
- [x] O `digest` que o usuário relata acha a linha do erro.
- [x] Erro repetido soma em "Vezes" e não vira linha nova.
- [x] Notificação só na primeira ocorrência.
- [x] Navegação normal não gera registro de erro.
- [x] Senha e token não aparecem em mensagem nem em stack.
- [x] E2E local verde.