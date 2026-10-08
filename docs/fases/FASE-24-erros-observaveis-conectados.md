# FASE 24 — Erros observáveis, de ponta a ponta

> Correção da lacuna que sobrou das FASES 20 e 21. Lá o funil passou a existir e o
> alerta a funcionar — mas ainda havia **erro que não chegava** a `/admin/erros`.
> Existia no log do container e não existia para o super admin.

## Contexto

O sintoma que abriu a fase: o sino avisa de um erro de servidor, o super admin clica, e a
tela diz *"Nenhum erro registrado"*. Investigando, não era um bug só — eram seis caminhos
por onde um erro escapava do funil.

## Causas e correções

### 1. O link apontava para o `id`, a busca não procurava por `id`

`reportNewError` e o template `ERROR_REPORTED` montavam `/admin/erros?busca=<id>`, mas
`listErrorLogs` procurava só em `message`, `digest` e `routePath`. O sino tocava, o clique
caía no vazio.

- A busca passou a aceitar `id` (`{ id: { equals: search } }`).
- O link passou a apontar para a **referência** que a tela documenta — o `digest` que o
  usuário viu —, com o `id` como fallback.

### 2. `logger.error` era um canal paralelo ao funil

Toda falha que um serviço capturava e **logava** (`falha ao gravar auditoria`, `falha ao
criar notificação`, `falha ao podar logs de erro`) morria no stdout. O `ErrorLog` só recebia
o que passava por `onRequestError`, `runAction`, guards de processo ou o cliente.

- Nova ponte `observability/logger-bridge.ts`: cada `logger.error` fora de um dispatch vira
  um `Incident` (`kind: "log"`).
- O logger é `lib/` e não pode importar `server/` (§4): o receptor é **registrado** no boot
  por `instrumentation.ts` (`setErrorReporter`), não importado.
- Guarda de reentrância com `AsyncLocalStorage` (`isDispatchingIncident`): os próprios sinks
  usam `logger.error` para relatar falha; sem a guarda, uma falha de destino geraria outra,
  em laço, justamente quando o sistema já está degradado.

### 3. `catch` de Route Handler engolindo erro

`/api/anexos/[id]` transformava qualquer falha de `readFile` em 404. Agora `ENOENT`
continua 404 (previsto) e falha real de I/O (permissão, disco) vira incidente. Os CSVs de
relatório já relançam (`throw`), e `/api/cnpj` já traduz tudo em `AppError` — esses já
chegavam ao funil.

### 4. O relato da Server Action saía com `void`

`runAction` disparava `void dispatchIncident(...)`. No servidor Node longo costuma
completar, mas uma promessa solta podia ser descartada com o fim da requisição — e o
incidente sumia onde mais importa. Trocado por `after()` do Next (§9.5): roda **depois** da
resposta, sem bloquear o balcão e sem perder o relato.

### 5. Falha ao gravar no banco sumia

`recordServerError` capturava qualquer erro de escrita e devolvia `skipped` — indistinguível
de "ruído ignorado". Agora devolve `failed`, e o destino do banco, quando falha, entrega o
incidente ao fornecedor externo e ao Telegram. O `ErrorLog` é o destino que não pode faltar;
quando ele falta, o erro não desaparece junto.

### 6. Filtro de ruído largo demais

`/^aborted\b/i` casava `"Aborted: cannot save item 5"` — defeito de verdade tratado como
cancelamento de navegação. O padrão passou a exigir a palavra exata (`/^aborted[.!]?$/i`).

## Como fica

```
logger.error ─┐
onRequestError┼─▶ dispatchIncident ─▶ error-log (sempre)
runAction     │        ▲            ├▶ better-stack
process-guards│        │            └▶ otel
error.tsx     ┘   isDispatchingIncident()
                  (guarda de reentrância)
```

## Verificação

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (**528**), `pnpm build`, `pnpm db:seed`.
- `pnpm build` sem nenhum aviso de Edge Runtime (a ponte entra por `import()` no `register()`
  guardado por `NEXT_RUNTIME === "nodejs"`).
- `logger-bridge.test.ts`: leva o `logger.error` ao funil, não relata dentro de um dispatch,
  não relata `warn`.
- `error-log.test.ts`: busca pelo `id` do link e não confunde "Aborted: …" com navegação.
- `funnel.test.ts`: o link da notificação carrega o `digest`.

## Critérios de aceite

- [x] O link da notificação leva à linha do erro (busca por `id` e por `digest`).
- [x] `logger.error` fora do funil vira incidente; dentro do funil, não vira laço.
- [x] Route Handler não engole falha real de I/O.
- [x] O relato da action não é descartado com a requisição.
- [x] Banco fora do ar não faz o erro desaparecer.
- [x] O filtro de ruído não esconde erro que começa por "Aborted".
- [x] Gates locais verdes, sem aviso de Edge Runtime.
