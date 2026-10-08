# Handoff — estado do trabalho

> Última atualização: 2026-10-08. Leia isto antes de retomar; evita redescobrir o contexto.

## Onde estamos

- Última release: **`v1.3.0`** (`e4311cd`), na `main`.
- A `develop` está **2 commits à frente** da `main`: o CI/CD da imagem (abaixo), ainda não
  publicado — e ele **não deve** ser publicado antes dos passos manuais daquele bloco.
- Nenhum PR aberto; nenhuma branch além de `develop` e `main`.
- **O fluxo mudou** (§10.1): feature abre PR para a **`develop`**; a `main` recebe um PR de release
  e só isso. Os dois rodam o E2E no Actions.
- **O deploy da `v1.3.0` ainda não apareceu em produção** — `/api/health` responde `1.2.0`. Ver a
  pendência do Dokploy abaixo.

## Trabalho atual — **FASE 24: erros observáveis de ponta a ponta** (`fix/erros-nao-aparecem`)

Correção de seis caminhos por onde um erro escapava da tela `/admin/erros`. O sintoma que abriu:
o sino avisa de um erro, o clique em **Erros** cai no vazio.

- **Busca por `id`** e link da notificação por `digest` (o `id` como fallback): o sino agora
  leva à linha.
- **`logger.error` entra no funil** (`observability/logger-bridge.ts`), com guarda de
  reentrância (`AsyncLocalStorage`) — uma falha de destino não vira laço de incidentes.
- **Route Handler** (`/api/anexos`) não engole falha real de I/O (só `ENOENT` é 404).
- **`runAction` usa `after()`** em vez de `void`: o relato não é descartado com a requisição.
- **Gravação no banco que falha** cai para o fornecedor externo + Telegram.
- **Filtro de ruído** não confunde `"Aborted: …"` com cancelamento de navegação.

Gates verdes: `lint`, `typecheck`, `test` (**528**), `build` (zero aviso de Edge), `db:seed`.
Doc na FASE 24; `AGENTS.md` §10.4 ganhou a regra de trabalho isolado (worktree por agente, `fix/`).

## Entrega local — simplificação visual, menu e código automático

Quatro frentes pedidas pelo dono do produto. Nenhuma muda regra de estoque, solicitação ou
chamado — a de patrimônio ainda é **desenho, não código**.

- **Escala +20%.** `html { font-size: 120% }` em `src/app/globals.css`. Como quase tudo no
  Tailwind é `rem`, um ajuste na raiz escala junto texto, espaçamento e altura de campo/botão.
  É o tamanho da interface resolvido num lugar só.
- **Menu por tarefa, com Início no topo.** `src/lib/navigation.ts` ganhou o grupo **Início**,
  sempre presente: a matriz vai para `/dashboard`, o admin de unidade para
  `/dashboard/unidade/[sua filial]` e os demais para `/meu`. O antigo grupo **Avançado** foi
  fundido em **Configurações** (no rodapé) e **Transferências** foi para **Insumo**.
- **Código do material é sempre automático.** O campo de SKU saiu do formulário: `createItem`
  gera pelo prefixo da categoria (`EPI-0007`) e `updateItem` não altera mais o código. Código de
  identificação é do sistema, não escolha do operador (AGENTS §3.11).
- **Patrimônio — FASE 23 (implementada).** `Asset` + `AssetEvent` (histórico append-only com
  trigger), etiqueta `PAT` global gerada pelo servidor, dono = pessoa com **Almoxarifado** como
  padrão. O bem nasce na entrada de item com número de série; **atribuir não gera saída de
  estoque** (posse ≠ propriedade); série implica patrimônio salvo `Item.trackAsAsset = false`.
  Telas `/patrimonio` e `/patrimonio/[id]` (ficha + histórico), no grupo **Insumo**. Permissões
  `patrimonio:read`/`patrimonio:manage`. O **chamado de TI se liga ao bem**: informar a etiqueta
  ao abrir o chamado põe o bem em `IN_MAINTENANCE` e encerrar o devolve ao estado anterior. E o
  bem **muda de unidade** pela ficha (só de `IN_STOCK`), indo para o almoxarifado de destino. Ver
  `docs/fases/FASE-23-patrimonio.md`.

## Entrega pronta, ainda não publicada — **CI/CD da imagem (GHCR)**

Mergeada na `develop` (PR #12). **Não publicada de propósito:** o caminho de deploy depende de
configuração que só existe no painel, e publicar antes disso faria o workflow falhar.

**O que muda:** a VPS **para de buildar**. Antes o Dokploy clonava o repo e rodava
`pnpm install && next build` no servidor — competindo com o ERP a cada release. Agora o
`release-image.yml` constrói no runner, publica no GHCR, dispara o deploy e **confere** que a
versão nova subiu.

```
release:publish → tag vX.Y.Z
  → Actions: build (linux/amd64, cache do GHA) → ghcr.io/<owner>/almo-erp:vX.Y.Z + :latest
  → Actions entra na tailnet (nó efêmero) e chama POST /api/application.deploy
  → Dokploy puxa a imagem e sobe
  → Actions confere /api/health até a versão nova responder
```

**Por que o runner dispara, e não um webhook:** o painel do Dokploy vive atrás do Tailscale, então
nem o webhook do GitHub nem o do Docker Hub o alcançam (verificado na doc do Dokploy: ele aceita
origem Docker/registry e o fluxo oficial é `POST /api/application.deploy`; "Schedule Jobs" rodam
comandos, não redeploys).

**O passo que faltava:** conferir. Um deploy que não acontece é o pior defeito possível — foi o que
deixou a produção servindo `1.2.0` depois da release da `1.3.0`.

### Passos manuais antes de publicar (sem eles a release não sai)

1. **Tailscale**: OAuth client com a tag `tag:ci` + ACL permitindo `tag:ci` → host do Dokploy, na
   porta do painel.
2. **GitHub → Secrets**: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `DOKPLOY_API_KEY`.
3. **GitHub → Variables**: `DOKPLOY_URL`, `DOKPLOY_APPLICATION_ID`, `NEXT_PUBLIC_APP_URL`,
   `NEXT_PUBLIC_SENTRY_DSN`.
4. **Dokploy → Application**: origem **Docker** (`ghcr.io/<owner>/almo-erp:latest`) com PAT de
   `read:packages`, e **Auto Deploy desligado**.
5. **Preview**: Application apontando para `:edge` (publicada à mão pelo `workflow_dispatch`).

### Dois achados no caminho

- **Bug que ia ser enviado:** o `Dockerfile` não declarava `ARG` para `NEXT_PUBLIC_SENTRY_DSN`.
  Build arg não declarado é **descartado em silêncio** e o `next build` congela o vazio — a
  captura de erro do navegador ficaria morta em produção, sem aviso.
- **Regra que estava documentada errada:** nem todo `NEXT_PUBLIC_*` é build arg. Só
  `NEXT_PUBLIC_SENTRY_DSN` é lida pelo navegador; `GOOGLE_CLIENT_ID` é lida no servidor e passada
  como prop (runtime); `APP_URL` e `APP_NAME` **não são lidas por ninguém** — configuração morta,
  candidata a limpeza.

## O que está pronto e verde

Gates locais: `pnpm lint`, `pnpm typecheck`, `pnpm test` (**522**), `pnpm build`, `pnpm db:seed`.
E2E: roda no GitHub Actions (ver FASE 22), **6,5 min** por run.

## Entrega mais recente — **FASE 21 + 22, observabilidade e E2E remoto** (`v1.3.0`)

Mergeado na `develop` (PR #9) e publicado na `main` (PR #10, tag `v1.3.0`).

**FASE 21 — o funil de incidentes.** A pergunta da FASE 20 respondida de vez: não só dá para
descobrir o que quebrou, o erro **chega** — e num formato que não prende o projeto num fornecedor.

- **Um incidente, vários destinos**, por variável de ambiente: `ErrorLog` (sempre, sem cota),
  Better Stack (SDK do Sentry apontado para o DSN deles) e **OTLP, já escrito e desligado** — que
  é o caminho para o Grafana na VPS, caso você decida ir para lá depois. Trocar de destino não
  toca em instrumentação.
- **`reportNewError` nunca era chamado** desde a FASE 20. Tinham testes, e mesmo assim o sino nunca
  apitou. A política de alerta agora mora no destino local, junto do agrupamento por fingerprint.
- **Erro de Server Action era invisível** — action não propaga exceção, devolve `{ ok: false }`, e o
  `onRequestError` só vê o que foi lançado na requisição. São ~105 call sites em 21 arquivos:
  `runAction` foi para `src/server/actions/run.ts` (porque `lib` não pode importar `server/`) e
  **nenhum call site mudou** — só a linha de import de cada arquivo.
- **Erro fatal de processo** (`uncaughtException`/`unhandledRejection`) e **erro de cliente**
  (`instrumentation-client.ts`, `global-error.tsx`, `error.tsx`) agora entram no funil.
- **Porta LGPD unificada.** Havia duas regras de remoção de dado pessoal — e a da FASE 20 descartava
  a linha inteira ao ver a palavra "CPF", matando o diagnóstico junto. Agora há uma só
  (`observability/scrub.ts`), que também remove CPF/CNPJ/e-mail **em texto solto**, onde não há
  nome de campo para filtrar.
- **Dois bugs reais que só rodando aparecem:** `ErrorLog` não tem coluna `createdAt` (tem
  `firstSeenAt`/`lastSeenAt`), e a poda que escrevi primeiro usava a coluna errada.
- **Retenção sem cron**, `connect-src` da CSP com a origem do DSN, e **zero** aviso de Edge Runtime
  no build — que é o teste de que o guard `NEXT_RUNTIME` está funcionando.

**FASE 22 — o E2E foi para o GitHub Actions.** Rodar a suíte local **derrubou a VPS**: carga 78 em
4 cores, `next dev` com 2,3 GB (39,8% da máquina) e um Chromium por worker. Teste de interface não
tem relação com o hardware que serve o ERP.

Referência medida do run completo: **6,5 min** — servidor 9 s, suíte 5 min, encerramento 0 s.

Custou cinco execuções para chegar lá, e vale registrar por quê, porque os dois problemas tinham
sintomas que apontavam para o lugar errado:

1. O `globalSetup` do warm-up **morria na primeira linha** (`page.goto` com URL relativa — o
   `globalSetup` não herda o `use` da config) e levava a suíte junto: zero testes rodaram em três
   execuções. O sintoma era "o job estoura o tempo", e eu escrevi na documentação que "a suíte não
   cabe" — **sem nenhum teste ter executado**.
2. Consertado isso, a suíte rodou em **4,5 min** e passou inteira (103 cenários). O job ainda batia
   o teto porque **travava ~19 min depois dos testes**: o `next dev` sobrevivia ao encerramento do
   Playwright, e o Playwright esperava por ele (`Terminate orphan process: (next-server)` no log,
   desde a primeira execução). Agora o servidor é do workflow: sobe com `setsid`, a suíte roda com
   `E2E_REUSE_SERVER=true`, e um passo `always()` mata o que sobrou.
- Agora roda **a cada PR para `develop` e `main`**, com `paths-ignore` para docs e
  `cancel-in-progress` (empurrar 5 vezes custa 1 run). `timeout-minutes: 15`.
- **Localmente, um spec por vez** (`--grep`). A suíte completa é do runner.
- **Dois testes flaky**, passam no retry: `admin-usuarios` "acessa a lista de usuários" e `filiais`
  "mostra os locais de estoque". Pendência de confiabilidade, não bloqueia.
- O caminho que foi **descartado**: conter o consumo na VPS com cgroup v2 (dois escopos, 1,5 GB +
  1 GB, `CPUQuota`, preflight). As peças foram verificadas em campo e funcionavam — mas a solução
  certa era **mover o trabalho para fora, não fazê-lo caber**.

**Pendências suas (painéis, não código):**
1. **Branch protection não existe** para repo privado no GitHub Free. Nada impede merge vermelho;
   o check aparece no PR, mas a imposição não. A saída gratuita é um script de merge que consulta
   `gh pr checks` — **não foi feito**, é a decisão em aberto.
2. **Os 5 passos manuais do bloco de CI/CD acima** — é o que destrava o deploy por imagem.
3. **Variáveis no Dokploy**: `NEXT_PUBLIC_SENTRY_DSN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
   `OTEL_EXPORTER_OTLP_ENDPOINT` só se for ligar o Grafana.
4. **UptimeRobot** em `/api/health` — é configuração no painel.

Entrega anterior — **FASE 20, observabilidade de erro**:

- **Erro de rota não some mais.** O gancho `onRequestError` do Next grava todo erro de render, route
  e action em `ErrorLog`, e a tela `/admin/erros` mostra. O `digest` que o usuário viu na tela
  ("Referência: abc123") é a chave de busca — fecha o ciclo do relato de suporte.
- **Uma linha por erro, não por ocorrência.** `fingerprint` único (rota sem query + digest +
  mensagem normalizada); o repetido soma em "Vezes". Sem isso, um erro alcançado por dez usuários
  viraria dez linhas e a tela viraria parede.
- **Alerta no sino só na primeira ocorrência**, para quem tem `papel:manage`. Notificar cada vez
  transformaria o sino em ruído justamente quando o problema é mais grave.
- **Dois achados que só aparecem rodando de verdade** (e que nenhum unitário pegaria):
  `The destination stream closed early.` — o Next descreve assim uma navegação RSC abandonada, que
  é comportamento normal e chega em volume alto; e `?_rsc=<hash>` na rota, que mudaria a cada
  visita e criaria uma linha nova por carregamento. Ambos viraram regra com teste.
- `instrumentation.ts` importa o serviço por `import()` dinâmico, guardado por
  `NEXT_RUNTIME === "nodejs"`: o arquivo roda na edge também, e a edge não tem Prisma.
- O registro no banco e o stdout são **complementares**: `ErrorLog` cai junto com o Postgres, e é
  justo quando mais importa. O `console.error` estruturado continua.
- Fora do escopo, por decisão: erro do **cliente** (tela branca) e log de uso. `/admin/erros` é
  reativa — o complemento seria um monitor externo de uptime em `/api/health`, sem código.

Entrega anterior — **GitHub Actions fora do caminho do dia a dia** *(superada em parte pela
FASE 22 — o `e2e.yml` voltou a rodar em PR)*:

- Naquele momento, **nenhum workflow rodava em push ou pull request**. O portão era local: o hook
  `pre-push` roda `lint + typecheck + test + build`, e o E2E também era local.
  - `tag-release.yml` **removido**: a versão passou a ser publicada por script local.
  - `ci.yml` e `e2e.yml` viraram `workflow_dispatch` (manuais, 0 minutos). `backup.yml` segue
    agendado — esse precisa estar remoto.
- **O motivo real da FASE 22 foi outro:** não foi a cota de minutos, foi a memória. Ver acima.
- **Ação sobre o Dokploy (pendente, é no painel):** apontar o Auto Deploy **por tag** em vez de
  por push na `main`. Hoje ele dispara no push; a intenção é que a tag `vX.Y.Z` seja o sinal.

Entrega anterior — **Release automática por Conventional Commits**:

- **Ninguém bumper versão à mão.** A versão é derivada dos commits desde a última tag: `feat` →
  minor, `fix`/`perf`/`refactor`/`revert` → patch, `!` ou `BREAKING CHANGE:` → major,
  `docs`/`chore`/`test` → não publica. `pnpm release:publish` grava o `package.json`, cria
  `chore(release): X.Y.Z` e publica a tag.
- A regra mora em `src/lib/release.ts` — **pura e com 25 testes**, sem git nem I/O;
  `scripts/release.mts` só executa a decisão. Erro de bump aparece em unitário, não depois da
  tag publicada.
- **Não cascateia** (o commit de release é `chore`, que não bumpa) e é idempotente.
- Depuração local: `pnpm release:dry`. Escape para hotfix pontual: `VERSION=1.2.3`.
- Dois bugs achados validando em clone real: o `%B` do git entrega a mensagem seguinte com
  `\n` na frente (o Conventional Commits deixava de casar e **toda versão era pulada em
  silêncio**), e o clone do Actions não tem identidade git (o commit de release morria depois do
  `package.json` já estar alterado).

Entrega anterior — **FASE 19, simplificação** (vinda de um teste real em produção):

- **O botão "Usar câmera" nunca funcionou** (bug da FASE 05, não desta fase). O leitor lia a
  ref do `<video>` antes de o elemento existir, então o clique morria em silêncio: zero `<video>`
  na tela e `getUserMedia` nunca chamado. O leitor agora só inicializa em efeito, depois que o
  elemento está montado. E2E cobre o stream real chegando ao vídeo (`e2e/estoque.spec.ts`, com a
  câmera sintética do Chromium ligada no `playwright.config.ts`) e a liberação do stream ao
  parar. O `@zxing/browser` é JavaScript puro, sem WebAssembly.
- **`unsafe-eval` na CSP só em desenvolvimento.** O runtime dev do React usa `eval()` para
  reconstruir call stacks e falar com o DevTools; sem ele, o console chia a cada navegação.
  Produção segue estrita — o bundle de produção não usa `eval`.

Entrega anterior a esta fase — **a entrada pela doca não tem cadastro prévio.** Ler o código de barras de um produto novo
  abre o cadastro mínimo (nome + unidade) **na própria tela** e já adiciona a linha. Antes o
  caminho morria em "Nenhum material com este código de barras" e obrigava sair da entrada.
  Mesmo caminho ao digitar o código, para o balcão sem celular.
- **Categoria "Geral" automática** (`ensureGeneralCategory()`), sem migration: em produção não
  existia categoria nenhuma, então `/catalogo/itens/novo` abria com o select vazio e nenhuma
  explicação. Ela **não exige aprovação** — o pedido continua na fila de quem responde.
- **`item:create` no papel ALMOXARIFE.** Sem isso o caminho da doca morre para quem opera.
- **Unidade nasce com o almoxarifado** (`ALMOX`), na mesma transação de `createBranch`.
- **Formulário de material enxuto:** nome, unidade e categoria (já preenchida); código, preço,
  código de barras, descrição e controles em "Opções avançadas".
- **Menu por tarefa:** Ação → Insumo → Consumo → Manutenção → Monitoramento → Configurações →
  Avançado. De ~20 itens para 6 grupos; transferência só aparece com 2+ unidades ativas.
- Bugs **pré-existentes** corrigidos no caminho: login local com senha errada caía no error
  boundary em vez de dizer "e-mail ou senha inválidos" (Auth.js v5 lança o `AuthError`); e o
  E2E de TI usava um e-mail que o seed não cria.
- Decisão consciente: **não** houve migration, **não** houve OCR, e o formulário de unidade
  ficou como está. Hubs com abas foram descartados — ver a FASE 19 para o porquê.

Entrega anterior — **Login local (e-mail + senha), sem Google**:

- Nova porta de acesso: provider `local` (Credentials) + `User.passwordHash`
  (scrypt em `src/lib/password.ts`). **Não** auto-provisiona e **não** aplica a
  regra de domínio — a conta é criada por admin/seed, então aceita e-mail pessoal.
- Toggles em `/admin/configuracoes`: `auth.localLogin.enabled` e
  `auth.google.enabled` (`Config` com `type: "boolean"`). Sem `AUTH_GOOGLE_ID`,
  o Google fica desligado e o botão aparece inerte.
- Freio de força bruta em `LoginThrottle` (5 falhas → 15 min), com a decisão pura
  em `src/lib/login-throttle.ts`.
- Seed: `SEED_ADMIN_PASSWORD` grava a senha do admin; `SEED_ADMIN_RESET_PASSWORD`
  recupera o acesso. `jose-guilherme93@hotmail.com` é o admin do `.env.production`.
- Testes: `password.test.ts`, `login-throttle.test.ts`, E2E `login-local.spec.ts`.

Entrega mais recente — **Exportação de relatórios (PDF + Google Drive) com auditoria**:

- **Snapshot imutável**: consolidar grava `ReportSnapshot` (dados, filtro, autor,
  hash SHA-256). Trigger no banco recusa `UPDATE`/`DELETE`; a tela reconstrói do
  snapshot, nunca reconsulta.
- **Registro de exportação**: `ReportExport` (CSV/PRINT/DRIVE, destino, data) +
  `AuditLog`. Histórico em `/relatorios/consolidados`.
- **PDF** via impressão do navegador; **Google Drive** via Google Identity
  Services com escopo mínimo `drive.file` (sem token no servidor). Requer
  `NEXT_PUBLIC_GOOGLE_CLIENT_ID` + Drive API/escopo no Google Cloud Console —
  sem isso o botão fica desabilitado (pré-requisito não configurado ainda).
- Testes: `report-snapshot.test.ts` (imutabilidade no banco, hash, auditoria,
  escopo), `drive.test.ts` (multipart/nome), E2E `relatorios.spec.ts`.

Entrega mais recente — **Fluxo de atendimento de chamados (TI/Manutenção)**:

- **Setor no vínculo**: `Membership.sectorId` editável na administração (criar
  usuário, adicionar e editar vínculo). É o que liga a pessoa ao setor de
  atendimento.
- **Visibilidade por setor de atendimento**: quem não tem `*:overview` enxerga o
  chamado/solicitação roteado ao seu setor (`serviceSectorId`) dentro das filiais
  a que tem acesso — antes disso um chamado de TI era invisível para o técnico
  até ser atribuído.
- **Fan-out por setor**: `MAINTENANCE_CREATED` vai para o setor de atendimento da
  filial (+ rede + responsável), com fallback para `manutencao:atender`; as
  notificações de encaminhamento passaram a filtrar por filial.
- **Home de quem atende**: técnico de TI cai em `/reparos`, com abertos por padrão
  e alternância para concluídos.
- **Dados**: `ti@batistaonline.com.br` (FILIAL-3) com setor TI. Obs.: o seed de
  demonstração também vincula esse e-mail a **FIL-SP** (setor TI); rodar
  `pnpm db:seed` recria esse vínculo. Remova-o ou ajuste o seed se o técnico
  deve atender só João Paulo.

Entrega mais recente — **Onda 1 de integridade** (plano em `docs`/handoff; ver abaixo):

- **Busca não vaza escopo de filial.** `listRequests` e `listMaintenanceRequests` combinam
  escopo e busca com `AND` (antes o `OR` da busca sobrescrevia o da visibilidade).
- **Lock pessimista** em reserva (`lockItemLevels`/`lockStockLevelById`), transferência e
  inventário (`lockFlowRow`), com testes de concorrência. `CHECK` de saldo/reserva no banco.
- **Entrega multi-local**: um `ISSUE` por prateleira; **lote** na reserva (FEFO pelo ledger),
  em `TransferLine` e no ajuste de inventário.
- **Cancelamento de documento vinculado** (`REQUEST`/`TRANSFER`/`INVENTORY`) bloqueado.
- Transição de recebimento de transferência passa pela máquina; atribuição de chamado idem.
- **Bugs achados pelo E2E (corrigidos):** `buscarItensAction`/`buscarPorCodigoBarrasAction`
  exigiam `item:read`, que o `SOLICITANTE` não tem — o fluxo central de pedido era impossível
  pela interface; e `RequestForm`/`StockDocumentForm` disparavam ação dentro do updater do
  `setLines` (setState durante render).
- **E2E dos fluxos críticos:** `e2e/solicitacoes.spec.ts` (pedido → aprovação → entrega),
  `e2e/estoque.spec.ts` (entrada, ajuste, transferência enviar/receber) e
  `e2e/inventario.spec.ts` (contar → encerrar → ajustar). Suíte chromium: **80/80**.

## Deploy

Infra: **uma VPS com Dokploy** (Traefik já incluído). A aplicação é buildada pelo
`Dockerfile` (**Auto Deploy** no push da `main`); o Postgres é um serviço do próprio
Dokploy; as migrations rodam no **entrypoint** do container (1 réplica, zero-downtime
desligado). Artefatos: `Dockerfile` + `docker-entrypoint.sh` + `.dockerignore`,
`.github/workflows/backup.yml` (cópia cifrada via SSH), `src/app/api/health/route.ts`,
`.env.production.example` (checklist) e o runbook `docs/DEPLOY.md`. O portão de qualidade
é o hook `pre-push` + o CI no PR.

Fluxo: push/merge na `main` → o **Auto Deploy do Dokploy** builda e sobe → o entrypoint
espera o banco, roda `prisma migrate deploy` e depois `pnpm start`. O **seed** roda uma vez
pelo *Run Command* do Dokploy (`pnpm db:seed`). Backup: Dokploy → S3 (principal, retenção
longa) + `backup.yml` (secundária, **cifrada** com AES256, 14 dias).

Decisões registradas: o seed decide pelo **ambiente explícito** — `SEED_DEMO_DATA=true`
liga a demonstração (empresa, filiais, catálogo, usuários com senha), e sem a flag (ou
`false`) ele cria apenas referência, uma filial matriz e o admin. É por isso que um
**preview** no Dokploy consegue ter dados de demonstração mesmo com `NODE_ENV=production`.
Divergência consciente do item da FASE 13. E2E continua local.

Pendências de produção (não bloqueiam o código): configurar o Dokploy (serviço Postgres,
S3 Destination, Application com domínio, volume `/data/uploads`, replicas=1 e env),
preencher os secrets do GitHub, apontar o DNS e testar a restauração do backup. No
primeiro deploy o acesso é pelo **login local** (sem Google).

## E2E — como rodar

O E2E é **local-first** (AGENTS §9.1). O bypass de autenticação de teste só existe fora de
produção, então o servidor é o `pnpm dev` (padrão do `playwright.config.ts`):

```bash
E2E_AUTH_BYPASS=true pnpm e2e --project=chromium
```

### Portas do dev local

- **3000 — container de produção do Dokploy** (`next-server`). Não é dev server, e o
  bypass de teste **não** existe aí: apontar o E2E para a 3000 faz o formulário de login
  de teste sumir. Se `localhost:3000` responder, é o container, não o seu dev.
- **3001 — `pnpm dev`** (definido em `package.json`). É a porta de desenvolvimento e a
  padrão do Playwright (`playwright.config.ts` e `e2e/helpers/flows.ts`). O `start` de
  produção continua na 3000 (via `PORT` do Docker).
- **Cuidado com `.env.local`:** um `.env.local` apontando `DATABASE_URL` para outro banco
  (ex.: Neon) tem prioridade sobre o `.env` e faz o dev usar o banco errado. Mantenha só o
  `.env` do Postgres local.

- Se já houver um `pnpm dev` na **3001**, o Playwright o reutiliza. Deixar o dev aberto
  também evita um detalhe: quando o Playwright sobe o servidor sozinho, o `next dev` filho
  pode não encerrar no fim e a CLI fica pendurada (mate o processo na 3001, se acontecer).
  **Importante:** depois de alterar `prisma/schema.prisma`, reinicie o `pnpm dev` — ele
  mantém o Prisma Client antigo em memória e o E2E falha com `Unknown argument`.
- `pnpm build && pnpm start` **não** serve para E2E (o `env.ts` recusa o bypass em produção).
- O `e2e.yml` do Actions é manual/opcional, capado em 5 min; não transformar em job longo.

Entregue antes:

- **Versão visível.** `semver+SHA` no `/api/health`, no header `X-App-Version`, no rodapé da
  sidebar e em `AuditLog.appVersion` (ADR-16). O SHA vem do build arg `GIT_SHA`.
- **Cadastro de unidade — consulta de CNPJ.** Botão "Buscar dados" preenche razão social,
  nome fantasia, CNAE e endereço via BrasilAPI (rota `/api/cnpj/[cnpj]`, ADR-15).
- **FASE 14 — Setores e encaminhamento.** `Sector`, `Membership.sectorId`,
  `sectorId`/`serviceSectorId` em `Request`/`MaintenanceRequest`; `Delegation` +
  `DelegationEvent` (almoxarifado encaminha etapa → setor responde com laudo → comando
  volta à origem). Visibilidade: solicitante só vê o próprio; setor de serviço só vê o
  que foi encaminhado a ele; `solicitacao:overview`/`manutencao:overview` = escopo.
- **FASE 15 — Mobile do solicitante.** `/solicitar` com 3 botões (material, reparo, TI),
  defaults preenchidos, `/meu` enxuto.
- **FASE 16 — Anexos.** Compressão no cliente (WebP ≤1600px), arquivo no volume
  (`UPLOAD_DIR=/data/uploads`), `/api/anexos/[id]` com a visibilidade da demanda pai.
- **FASE 17 — TI e peças.** Categoria `IT` roteia para a TI; `/encaminhamentos` com laudo.
- **FASE 18 — Relatórios.** "Demanda por setor" e "Duração das demandas".
- **Correções:** super admin/matriz enxergam e são notificados dos pedidos das unidades;
  todo indicador do dashboard abre a lista equivalente (`?filial=`, `?emTransito=1`,
  `?relatorio=`); teste `dashboard.test.ts` prova contagem × lista.
- **CI:** `.github/workflows/ci.yml` só dispara em `main`, com `timeout-minutes: 5`;
  e2e virou manual (`e2e.yml`, `workflow_dispatch`, teto de 5 min). Regra em `AGENTS.md §9.1`.

## Comandos de verificação

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm db:seed
```

## Pendências conhecidas (escopo, não bug)

- Senha de usuário local pela administração (`/admin/usuarios`): hoje só o seed grava
  `passwordHash`. Sem uma tela para definir/trocar senha, usuários locais além do admin
  do seed não têm como entrar. `createUser` também ainda exige domínio corporativo.
- CRUD de setores na administração.
- Criar a solicitação de peça **a partir** do laudo da TI (`Request.spawnedFromDelegationId`
  já existe no schema, falta a ação/tela).
- Mostrar "veio do chamado TI-xxxx" na solicitação originada de um encaminhamento.
- Ligar chegada da peça (`WAITING_PARTS → IN_PROGRESS`) ao recebimento da solicitação.
- Anexos em object storage (Cloudflare R2) — só se um dia o volume não servir (múltiplas instâncias).
- Gráfico de evolução mensal na tela de relatórios.

## Aviso não bloqueante

- O `pnpm build` emite um aviso do Turbopack sobre acesso dinâmico ao diretório de uploads
  (tracing). Não quebra o build.

## Mapa rápido

- Setores: `src/server/services/sector/`.
- Encaminhamento: `src/server/services/delegation/` + `src/server/actions/delegacao.ts` +
  `/encaminhamentos`.
- Anexos: `src/server/services/attachment/`, `src/lib/image-compression.ts`,
  `src/app/api/anexos/[id]/route.ts`.
- Relatórios: `src/server/services/reports/index.ts`.
- Visibilidade/escopo: `src/server/auth/scope.ts`, filtros em `request/` e `maintenance/`.
- Permissões: `src/lib/permissions/catalog.ts` + `matrix.ts` (papel `TI` incluído).
- Dashboards: `src/server/services/dashboard/index.ts` + páginas em `src/app/(app)/dashboard/`.

## Decisões de domínio que não podem ser quebradas

- Saldo negativo é proibido; estoque só muda por `StockDocument` em transação (AGENTS §3.3).
- Status muda só por função de transição (AGENTS §3.4).
- Autorização no servidor; toda query de negócio filtrada por escopo (AGENTS §3.1/§3.2).
- Urgência é de quem recebe; unidade é de quem pede; criar já é enviar (AGENTS §3.7/§3.8).
