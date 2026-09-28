# Decisões de arquitetura

Registro do **porquê** de cada decisão relevante. O **como** está em
[`AGENTS.md`](../AGENTS.md); o que muda aqui deve ser registrado aqui.

---

## ADR-01 — Autorização no servidor, não no `proxy.ts`

**Contexto.** O Next.js tem uma camada de borda (antes `middleware.ts`, hoje
`proxy.ts`) que roda antes das rotas. É tentador colocar toda a autorização lá.

**Decisão.** A borda faz **apenas** o gate de sessão ("existe sessão?"). Toda autorização
real acontece no servidor, a cada requisição, lendo o banco em `getAuthContext()` +
`guards`.

**Por quê.** Houve um advisory de segurança do Next.js (julho/2026) sobre bypass de
middleware com Turbopack. Autorização que depende da borda é autorização que pode ser
contornada. Além disso, a borda não tem acesso ao banco: checar papel ou filial lá
exigiria confiar no conteúdo do token, que fica desatualizado.

**Consequência.** Uma requisição faz uma leitura a mais no banco. É o preço da
segurança — e o mesmo mecanismo faz suspender um usuário valer imediatamente.

---

## ADR-02 — Permissões resolvidas por filial

**Contexto.** Um usuário pode ser `ALMOXARIFE` em uma unidade e `CONSULTA` em outra.
Guardar um conjunto único de permissões por sessão é mais simples.

**Decisão.** As permissões são resolvidas **por filial**
(`context.hasPermission(permissao, branchId)`), e toda ação de unidade chama
`requireBranch(branchId)` além de `requirePermission`.

**Por quê.** Com o conjunto unificado, um usuário com `solicitacao:approve` em São Paulo
aprovaria também no Rio — desde que ele tivesse **qualquer** vínculo no Rio. O furo é
silencioso e só aparece em produção.

---

## ADR-03 — Estoque com ledger append-only e saldo materializado

**Contexto.** Duas opções: calcular o saldo somando as movimentações, ou manter um saldo
atualizado.

**Decisão.** As duas coisas. `StockLine` é a **verdade** (append-only, nunca sofre update
nem delete) e `StockLevel` é um **cache** por item + local. Toda alteração de saldo passa
por um documento, dentro de uma transação, com `SELECT … FOR UPDATE` na linha de saldo.

**Por quê.** Calcular o saldo a cada consulta não escala no catálogo e nas listagens.
Guardar só o saldo perde a trilha de auditoria — e em almoxarifado a pergunta "quem tirou
isso" é metade do trabalho.

**Detalhes que a implementação exige:**

- quantidade **assinada** (positiva entra, negativa sai): o sinal define o efeito, não o
  tipo do documento, evitando duas fontes de verdade;
- lock em ordem determinística de `id`, senão transações concorrentes causam deadlock;
- saldo negativo é proibido e a saída valida contra o **disponível**
  (`quantidade − reservado`), não contra a quantidade — senão a entrega de uma solicitação
  consumiria o material reservado para outra;
- cancelar **não apaga**: gera o documento inverso.

---

## ADR-04 — Reserva na aprovação, baixa na entrega

**Contexto.** Quando descontar o estoque de uma solicitação aprovada?

**Decisão.** Aprovar **reserva**; entregar **baixa**. A reserva é por **local**
(`StockLevel`), não por filial.

**Por quê.** Se a aprovação já baixasse, o saldo refletiria material que ainda está na
prateleira. Se nada fosse reservado, dois aprovadores poderiam aprovar o mesmo item duas
vezes e a segunda entrega falharia na hora da retirada — com o solicitante já esperando.

Reservar por local porque na entrega o almoxarife precisa saber **de qual prateleira**
tirar. A escolha prefere o almoxarifado principal e, depois, o local com mais disponível.

---

## ADR-05 — Decimal para dinheiro e quantidade

**Contexto.** `number` do JavaScript é ponto flutuante binário: `0.1 + 0.2 !== 0.3`.

**Decisão.** `Decimal(18,4)` para quantidade e `Decimal(14,2)` para dinheiro, em todo o
caminho. Formatação só na borda, com `Intl`.

**Por quê.** Em estoque, erro de arredondamento acumulado vira divergência de inventário;
em custo médio, vira valor de patrimônio errado. E o erro é silencioso.

**Achado real.** O método `Decimal.isPositive()` do Prisma devolve `true` para **zero**
(o zero tem sinal positivo). O uso desse método em cinco pontos causou, entre outras
coisas, divisão por zero no custo médio e bloqueio indevido de cancelamento de
transferência. A regra passou a ser comparar explicitamente com zero
(`.greaterThan(0)`).

---

## ADR-06 — Notificação no banco, na mesma transação

**Contexto.** Notificar por e-mail, push ou fila é o caminho usual.

**Decisão.** A notificação é uma linha em `notifications`, criada **dentro da transação**
do evento que a originou. E-mail e push entram depois, lendo a mesma tabela.

**Por quê.** Notificar fora da transação cria dois problemas: notificação de algo que não
aconteceu (a ação falhou depois) e evento sem notificação (o processo de notificação
falhou). Com a transação única, os dois são impossíveis. Foi testado com rollback
forçado.

**Consequência.** O sistema não depende de infraestrutura externa para funcionar, e o
canal é trocável sem mexer na regra de negócio.

---

## ADR-07 — Auth.js v5 com sessão JWT, sem tabela de sessão

**Contexto.** O Auth.js pode persistir sessão em banco (adapter) ou em JWT.

**Decisão.** JWT, sem adapter. O token carrega apenas `userId` e `status`.

**Por quê.** A autorização real já é recalculada do banco a cada requisição (ADR-01).
Persistir a sessão não acrescentaria segurança, só mais uma tabela para manter — e
adicionaria uma consulta por requisição de qualquer forma.

---

## ADR-08 — Regra de e-mail em duas camadas com `EmailPolicy`

**Contexto.** O requisito é "só e-mails corporativos", com a possibilidade futura de
regras por middleware.

**Decisão.** Duas camadas independentes e testáveis:

1. **Domínio e padrão** (`src/lib/email-policy.ts`, funções puras): o domínio precisa
   estar em `AUTH_ALLOWED_DOMAINS` **ou** em uma `EmailPolicy` ativa; o padrão opcional
   (regex) precisa casar.
2. **Usuário** (`provisioning.ts`): o e-mail precisa existir e estar `ACTIVE`.

**Por quê.** Separar as camadas permite testar a regra mais sensível do sistema sem
banco. E a `EmailPolicy` no banco permite ligar um domínio, exigir um padrão de e-mail ou
auto-aprovar o primeiro login **sem deploy** — que é exatamente a evolução pedida.

Regex inválida nunca libera acesso: uma política quebrada bloqueia, não abre.

---

## ADR-09 — Erros de domínio com mensagem pronta para o usuário

**Contexto.** Erros técnicos vazando para a tela (stack trace, mensagem do Postgres).

**Decisão.** Toda falha esperada é uma subclasse de `AppError` com mensagem em português
pronta para exibição. `runAction` converte: `AppError` expõe a mensagem de negócio,
qualquer outro erro vira mensagem genérica e vai para o log.

**Por quê.** O almoxarife precisa saber **o que fazer** — "saldo insuficiente para
Capacete: solicitado 10, disponível 3". Um stack trace não diz nada e ainda expõe a
estrutura interna.

---

## ADR-10 — Filtros na URL, não em estado local

**Decisão.** Busca, filtros, ordenação e paginação vivem em `searchParams`. Tabela,
preset de período e relatório são reproduzíveis por link.

**Por quê.** Tela compartilhável, botão voltar funcionando e nenhuma duplicação entre
estado do cliente e dado do servidor. Custa alguns componentes cliente a mais.

---

## ADR-11 — CSV com BOM, separador `;` e decimal com vírgula

**Contexto.** O CSV "correto" (vírgula, UTF-8 sem BOM) abre ilegível no Excel em
português.

**Decisão.** CSV com BOM UTF-8, separador `;` e decimal com vírgula. Aspas, `;` e quebra
de linha são escapados.

**Por quê.** O destinatário do relatório é o administrativo, com Excel pt-BR. Um arquivo
"tecnicamente correto" que abre com "Ã§Ã£o" no lugar de "ção" é um arquivo inútil.

---

## ADR-12 — Testes de integração contra o banco, em série

**Contexto.** Boa parte das regras (lock de estoque, escopo por filial, transições)
só se prova com banco real.

**Decisão.** Testes de integração contra o Postgres, com isolamento por escopo de dados
de teste e `fileParallelism: false`.

**Por quê.** Mocks de Prisma testariam o mock, não a regra. Rodar em paralelo contra o
mesmo banco faz um teste limpar o dado do outro — a solução foi limitar cada limpeza aos
próprios registros **e** rodar os arquivos em série. O primeiro erro foi
justamente esse: uma limpeza ampla derrubava arquivos vizinhos.

---

## ADR-13 — Provider de credenciais apenas para teste, com duas travas

**Contexto.** Não dá para automatizar login no Google em teste. Sem isso, nenhuma tela
autenticada teria cobertura e2e.

**Decisão.** Um provider `e2e` que aceita e-mail, disponível apenas quando
`E2E_AUTH_BYPASS=true`. Duas travas independentes:

1. `authorize` recusa se a variável não estiver ligada;
2. `src/lib/env.ts` **derruba a aplicação** se `NODE_ENV=production` e a variável estiver
   ligada.

**Por quê.** Testar a aplicação de verdade exige passar pelas mesmas regras (domínio,
status do usuário, permissões). E uma porta dos fundos de autenticação precisa falhar
alto se alguém errar a configuração — falhar em subir é melhor que subir aberto.
