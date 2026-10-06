# FASE 21 — Observabilidade profissional

> A FASE 20 deixou a pergunta errada respondida: agora dá para **descobrir** o
> que quebrou. Esta fase responde à pergunta certa: **o erro chega até mim sem que
> eu precise abrir nada?**

## Contexto

Depois da FASE 20, o `ErrorLog` exists, a tela `/admin/erros` existe e a notificação
existe. Mas o operador ainda precisa **abrir o ERP** para saber que algo quebrou —
e a tela só existe para quem está logado. Em produção, numa VPS, a diferença
entre "sabe que quebrou" e "descobre quando alguém reclama" é a diferença entre
um incidente e um Motorola.

Três lacunas concretas:

1. **A notificação nunca disparava.** `reportNewError` existia, tinha teste, e
   **não era chamado em lugar nenhum** desde a FASE 20. Um serviço que parece
   funcionar porque tem teste unitário, e não porque está ligado.
2. **Erro de Server Action era invisível.** Uma action não propaga exceção: ela
   devolve `{ ok: false }` ao componente. O `onRequestError` só enxerga o que foi
   lançado na requisição — e o erro já tinha sido engolido antes. São ~105 call
   sites em 21 arquivos: a maior classe de erro do sistema não chegava a lugar
   nenhum.
3. **Erro de cliente não existia.** Tela branca e falha de hidratação morrem no
   navegador; o `console` de quem está com pressa não é canal de observabilidade.

E uma decisão que vem antes de tudo: **nenhum fornecedor é obrigatório**. O que
entra em produção é o funil; o destino é configuração.

## A decisão de arquitetura: funil com saída plugável

O único motivo de existir um `IncidentSink` é a chance concreta de o destino
mudar — e ela já mudou de ideia uma vez durante a fase (Sentry → Better Stack).
Em vez de reescrever instrumentação, troca-se o DSN.

```
                    ┌─ error-log      (sempre ligado, sem cota, dentro da VPS)
dispatchIncident ───┼─ better-stack   (Sentry SDK apontando para o DSN deles)
                    └─ otel           (pronto, desligado — é o caminho do Grafana)
```

O destino OTLP **já está escrito e desligado**, com teste de integração que sobe
um servidor HTTP e prova que o evento chega no formato certo. Isso é deliberado:
descobrir porta fechada ou formato errado no dia da migração seria o pior momento
possível. Ligar é definir `OTEL_EXPORTER_OTLP_ENDPOINT` no Dokploy — nenhum
código muda.

## Tarefas

- [x] `src/server/services/observability/` com o funil: `index.ts` (tipo
      `Incident`, `IncidentSink`, `dispatchIncident`), `scrub.ts`, `ignorable.ts`,
      `alert.ts`, `retention.ts`, `report.ts`, `process-guards.ts`, e um sink por
      destino.
- [x] `@sentry/nextjs` com os três arquivos de configuração (server, edge,
      client). **Sem** `withSentryConfig`: ele tenta subir source map no build e
      quebraria sem token, e um build que depende de opcional é pior que um stack
      ofuscado.
- [x] `src/instrumentation.ts` reescrito. Quase nada é importado no topo: o arquivo
      também roda na **edge**, e a edge não tem Prisma nem `node:crypto`. Tudo que
      depende de Node entra por `import()` dinâmico **guardado por `NEXT_RUNTIME`**
      — sem o guard, o Turbopack inclui o cliente de banco no bundle da edge e a
      aplicação quebra ao subir.
- [x] `instrumentation-client.ts` + `src/app/global-error.tsx` + relato no
      `error.tsx` das rotas `(app)` e `(auth)`.
- [x] `runAction` movido de `lib/action-result.ts` para `src/server/actions/run.ts`.
      `lib` não pode importar `server/` (AGENTS.md §4), então o relato não cabia
      lá. Os ~105 call sites não mudaram: **só a linha de import** de cada arquivo.
      Relata só o que não é `AppError` — falha prevista não é incidente.
- [x] `src/server/actions/run.test.ts`: erro de domínio não é incidente, `redirect()`
      escapa, recurso não implementado é, e a rota sai de `next-url`/`referer` sem
      query string.
- [x] Erros fatais de processo: `uncaughtException` e `unhandledRejection`, que
      acontecem **fora** do ciclo de requisição e morriam em silêncio.
- [x] `shortSummary`, `scrubIncident`, alerta de Telegram com freio de 15 min por
      rota+mensagem, e `resetEnvCache` em `src/lib/env.ts` (sem ele, nenhum teste
      de configuração opcional conseguiria ler o que acabou de configurar).
- [x] Retenção oportunista do `ErrorLog`, sem cron: roda junto com a gravação, no
      máximo uma vez por hora.
- [x] `next.config.ts`: `connect-src` passa a incluir a origem do DSN.
      `'self'` sozinho **derruba o SDK silenciosamente** — o navegador bloqueia, o
      SDK não recebe confirmação, e a única pista é um aviso no console.
- [x] `docs/ARQUITETURA.md` §10.2, `AGENTS.md` §9.5/§9.6, `docs/DEPLOY.md`.

## Achados durante a execução

Rodar de verdade expôs coisas que nenhum teste unitário pega:

1. **`reportNewError` nunca foi chamado.** Ver acima. A verificação de ponta a
   ponta do funil (`funnel.test.ts`, contra o banco de verdade) é o que prova que
   as camadas estão **ligadas** — um funil desconectado passa em todos os testes
   de unidade e continua invisível em produção.
2. **Duas regras de remoção de dado pessoal.** `error-log.ts` tinha a sua própria
   (descartava a linha inteira ao ver a palavra "CPF"), e o `scrub` do funil tinha
   outra. Duas listas divergem, e a divergência aparece como **vazamento**. Agora
   há uma só, e `error-log.ts` reexporta dela.
3. **CPF em texto solto não era removido.** O filtro antigo olhava o *nome* do
   campo; numa mensagem de erro não há campo, é o valor. Num ERP escolar, um CPF
   solto identifica aluno, professor ou fornecedor.
4. **`ErrorLog` não tem `createdAt`.** A poda que escrevi primeiro usava a coluna
   errada — só o teste contra o banco revelou. E a coluna certa é `lastSeenAt`, por
   um motivo melhor: erro resolvido que **continua voltando** tem o `lastSeenAt`
   atualizado e sobrevive à poda, que é o comportamento correto.
5. **A linha omitida precisa de marca.** O filtro antigo apagava a linha em
   silêncio. Saber que havia uma segunda linha — e que ela foi removida — faz
   parte do diagnóstico; o sumiço se confunde com "o erro veio em uma linha só".
6. **Redundância entre o gravador e o funil.** `ErrorLog` já guardava mensagem e
   stack sem dado pessoal, e o funil limpa de novo. Barato e defensivo — a regra
   que decide o que sai do processo precisa estar em um lugar só, e esse lugar é
   o funil.
7. **Erro de domínio estava virando incidente.** As primeiras linhas gravadas no
   banco depois de rodar a interface eram `"A justificativa do ajuste é
   obrigatória"` e `"Este e-mail não é de um domínio corporativo autorizado"` — ou
   seja, `AppError` de validação, que é o **produto recusando uma operação**,
   não um defeito. Como a tela já mostra a mensagem, reportar aquilo faria o
   `ErrorLog` e o Telegram encherem de erro de digitação e o defeito real se
   esconder no meio. `runAction` agora só relata o que não é `AppError` — com uma
   exceção: `NOT_IMPLEMENTED`, que é produto incompleto e precisa aparecer.
8. **Toda incidente de action nascia sem rota.** A rota vinha do cabeçalho
   `next-url`, que o Next envia na **navegação RSC** — e a maioria das actions
   chega por POST de formulário, sem ele. Todas ficaram como `(server action)`, o
   que inutilizava o filtro por tela em `/admin/erros`. A lista de cabeçalhos
   ganhou `referer`, que é o que o navegador de fato envia nesse caso.

## Verificação ponta a ponta

`src/server/services/observability/funnel.test.ts` fala com o banco de verdade:

- incidente com CPF e e-mail na mensagem → gravado **sem** os dois, e com o texto
  que faz o diagnóstico preservado
- mesmo erro 3× → **1 linha** com `count: 3`
- notificação só na primeira ocorrência
- cancelamento de navegação não grava nada
- destino que lança não propaga — **e o erro mesmo assim é registrado**
- `ValidationError` (campo obrigatório, e-mail fora da política) **não** vira linha,
  e `Error` inesperada vira

## Porta LGPD

`scrub.ts` é a barreira, e é a única saída do processo: um sink novo que esqueça
de chamar `scrubIncident` vazaria, e a falha só apareceria em produção.

Remove: senha, token, cookie, `authorization`, JWT, hex longo, credencial em URL,
**CPF, CNPJ e e-mail** — inclusive em texto solto. Descarta a query string (em
relatório ela carrega filtro de pessoa) e o corpo da requisição. A régua é
propositalmente larga demais: melhor perder um campo útil do que deixar vazar um
CPF.

## Fora do escopo

- **Grafana self-hosted** — o caminho está pronto e desligado (sink OTLP com
  teste de integração), mas subir Grafana + Loki + Tempo numa VPS de 2 vCPU /
  4 GB foi rejeitado: consome mais que o ERP.
- **UptimeRobot** — é configuração no painel, não código.
- **Trace/performance.** `tracesSampleRate` começa em 0: a cota do plano gratuito
  fica inteira para o que importa, que é o erro.
- **Métrica de negócio (uso, gargalo).** É outro produto.

## Critérios de aceite

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` (508), `pnpm build`, `pnpm db:seed`.
- [x] Erro de Server Action chega ao funil.
- [x] Erro de cliente chega ao destino externo, **sem** escrever no banco.
- [x] Erro fatal de processo é reportado.
- [x] Alerta de Telegram não enche o chat com o mesmo erro.
- [x] Erro repetido não vira linha nova nem notificação nova.
- [x] CPF e e-mail não aparecem no `ErrorLog`, no destino externo nem no Telegram.
- [x] `ErrorLog` não cresce sem limite.
- [x] Zero aviso de Edge Runtime no build.
- [x] Sem DSN, sem Telegram e sem OTLP: a aplicação sobe e funciona igual.
- [ ] **E2E verde** — roda no GitHub Actions, a cada PR para `develop`
      (AGENTS.md §9.4). Não roda localmente: ver a justificativa do custo de
      memória em `FASE-22-e2e-remoto.md`.