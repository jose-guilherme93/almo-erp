# FASE 22 — E2E remoto

> Rodar a suíte de interface localmente **derrubou a VPS**. Não foi quase: carga
> 78 em 4 cores, 3,7 GB de swap em uso, `next dev` sozinho com 2,3 GB (39,8% da
> máquina) e um Chromium por worker. O kernel escolheu o que matar, e matou
> processos de todo mundo.

## Contexto

Até aqui o E2E era local por decisão registrada em `AGENTS.md` §9.3: *"E2E é local
e faz parte do fechamento do trabalho"*. O motivo declarado era economia — não
queimar os 2.000 min/mês do plano gratuito repetindo um portão que já passou.

O motivo real só apareceu quando alguém rodou de verdade, numa máquina que não
está limpa: **esta máquina é uma VPS de 6 GB dividida com outros usuários.**
Teste de interface abre um Chromium por worker, ao lado do `next dev`, e compete
por CPU com quem está trabalhando. Teste de interface não tem relação nenhuma com
o hardware que serve o ERP.

## A decisão

O E2E passa a rodar no GitHub Actions, a cada PR. A justificativa é de **lugar**,
não de dinheiro:

> Carga descartável e isolada pertence a runner descartável. O ERP pertence à
> VPS; o teste de interface pertence ao runner.

Consequência aceita, e ela é real: **o feedback chega depois do push**, em vez de
antes. O `pre-push` continua cobrindo `lint`, `typecheck`, `test` e `build` de
forma síncrona e imediata; só a prova de ponta a ponta pela interface é remota.

### O caminho que foi descartado, e por quê

A primeira tentativa foi conter o consumo em vez de mudar o lugar: cgroup v2 com
dois escopos (1,5 GB para o runner, 1 GB para o dev server), `CPUQuota`,
preflight recusando a execução com a máquina carregada, e flags de memória do
Chromium. As três peças foram verificadas em campo e funcionavam:

| Verificado nesta máquina | Resultado |
|---|---|
| `MemoryMax=64M` | `memory.max=67108864` aplicado |
| Estourar o teto | escopo morto (`137`), **máquina e processos intactos** |
| `CPUQuota=120%` | `cpu.max=120000 100000` |
| `MemoryPeak` | leitura disponível, para calibrar o teto |

Funcionaria. Mas é máquinação para fazer caber um trabalho que não deveria estar
nessa máquina, e o resultado seria o mesmo com menos peça: mover o E2E apaga o
problema por construção, em vez de administrá-lo.

## Tarefas

- [x] `e2e.yml`: gatilho `pull_request` para `develop` e `main`, com
      `paths-ignore` para documentação, mais `workflow_dispatch` para rodar à mão.
- [x] `concurrency` com `cancel-in-progress`: empurrar cinco vezes no mesmo PR
      custa **um** run completo, não cinco. É o que segura a cota.
- [x] `timeout-minutes: 25`, com exceção documentada ao teto de 5 min de §9.1.
- [x] `SEED_ADMIN_PASSWORD` no workflow. **Furo pré-existente:** `login-local.spec.ts` entra com
      `dev-senha-1234`, mas o seed só grava `passwordHash` quando essa variável existe. O spec
      nunca poderia ter passado no Actions — e o sintoma (`?error=CredentialsSignin`) parece
      defeito de login quando é só variável faltando.
- [x] `pnpm db:generate` explícito. Já houve run que falhou com `count: 0` vindo de
      um client do Prisma desatualizado — falha silenciosa, em que a suíte passa
      em parte e quebra em outra, e parece defeito de teste.
- [x] `playwright.config.ts`: `workers: 2` no CI, `1` local. O CI usava 1 porque a
      cota de minutos era a preocupação da época; hoje a restrição real é a CPU do
      runner (2 vCPU), não a máquina de desenvolvimento.
- [x] `playwright.config.ts`: comentário do `webServer` corrigido. Ele prometia
      `build && start` no CI — nunca esteve ligado, e é proibido de qualquer forma,
      porque o bypass de autenticação de teste só existe fora de produção
      (`src/lib/env.ts`) e `next start` roda com `NODE_ENV=production`.
- [x] Regra local: **um spec por vez**, via `--grep`. Suíte completa é do runner.

## O que NÃO foi feito, e é decisão

- **Branch protection.** Não existe para repositório privado no GitHub Free — é
  feature do Pro/Team. Então **nada impede um merge com o E2E vermelho**, e isso é
  aceito conscientemente. O check continua aparecendo no PR; o que falta é a
  imposição. A saída gratuita é mover o portão para o lado do operador: um script
  de merge que consulta `gh pr checks` e recusa enquanto não estiver verde.
  Fica como pendência, não como esforço escondido.
- **Warm-up das rotas — feito, e foi o que faltava.** O primeiro run bateu o teto de 15 min; o
  segundo, o de 25. O setup leva ~4 min, então a suíte passava de 20 min de execução. A causa não
  era o runner: `next dev` compila cada rota na primeira visita, e com ~32 telas essa compilação
  acontecia **dentro** do `expect.timeout` de cada teste — falha por lentidão que não é defeito de
  ninguém, e o `retries` repetia cada uma dobrando o custo. Agora `e2e/global-setup.ts` faz login
  uma vez e visita todas as telas antes do primeiro teste. Um login basta porque a compilação é por
  **rota**, não por permissão.
- **Sharding.** Continua descartado enquanto o warm-up der conta: custa 3× os minutos, e cada
  shard paga o setup inteiro de novo.
- **Diagnóstico preservado.** O relatório subia com `!cancelled()`, que é falso justamente no
  cancelamento — as duas primeiras execuções ficaram sem nenhum dado sobre o que passou e o que
  falhou. Agora é `always()`, e o reporter `list` transmite o progresso ao log.

## Critérios de aceite

- [x] PR aberto para `develop` dispara o workflow.
- [x] Documentação-only não dispara (custa zero minuto).
- [ ] Empurrar de novo cancela o run anterior em vez de enfileirar.
- [ ] Run completa e passa, dentro do teto de 25 min.
- [x] Relatório disponível mesmo quando o job é cancelado.
- [x] Lista de telas num lugar só, sem duplicar com `mobile.spec.ts`.
- [ ] Tempo real registrado, para decidir warm-up/sharding com número.
- [x] `login-local.spec.ts` deixa de falhar por variável faltando no workflow.