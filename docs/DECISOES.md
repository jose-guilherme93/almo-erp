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

---

## ADR-14 — Empresa e unidade são a mesma entidade (`Branch`)

**Contexto.** O schema tem `Company` (razão social, nome fantasia, CNPJ) e `Branch`
(unidade operacional, com CNPJ próprio). Isso sugere uma hierarquia de grupo — uma
empresa com várias filiais — e gerou a dúvida de como modelar um grupo com matriz +
outras empresas.

**Decisão.** Neste projeto **não existe dimensão de "empresa/grupo" separada da filial**.
Toda unidade é um `Branch` com o próprio CNPJ; a matriz é uma `Branch` com
`type = MATRIX`. O `Company` fica no schema apenas como rótulo jurídico criado pelo
seed: não tem CRUD, não tem regra de negócio, e `Branch.companyId` é um agrupamento
opcional que a operação não usa. Quem enxerga a rede é o **papel** com escopo
`ALL_BRANCHES` (`SUPER_ADMIN`, `ADMIN_MATRIZ`), não o tipo da filial.

**Por quê.** Operacionalmente só `Branch` importa: estoque, solicitação, aprovação,
entrega, inventário e notificação pendem todos de `Branch`, e cada filial já carrega
seu próprio CNPJ. Criar uma camada de empresa antes de existir necessidade real de
relatório ou limite por CNPJ adicionaria um eixo sem uso.

**Consequência.** As filiais de um grupo aparecem lado a lado, sem agrupamento por
empresa (a hierarquia `Branch.parentId` é editável no cadastro, mas não concede visão
de rede). Há uma única matriz global e um único limite de aprovação da matriz
(`request.matrixApprovalThreshold`), não um por empresa. A decisão é reversível: para
agrupar por empresa no futuro, `Branch.companyId` já existe (nullable) — basta o
cadastro de `Company` e o filtro nos relatórios; nada de estoque ou autorização muda.

---

## ADR-15 — Consulta de CNPJ via BrasilAPI, mediada pelo servidor

**Contexto.** O cadastro de filial tem muitos campos fiscais e de endereço (razão social,
nome fantasia, CNAE, CEP, logradouro, bairro, município, UF). Digitar tudo à mão é lento e
propenso a erro.

**Decisão.** Um botão **"Buscar dados"** no cadastro consulta a **BrasilAPI**
(`/api/cnpj/v1/{cnpj}`, pública e sem chave) por meio de uma rota nossa
(`/api/cnpj/[cnpj]`) e preenche os campos. A rota exige `filial:create`/`filial:manage` e
devolve um payload normalizado; o mapper puro (`src/lib/cnpj.ts`) isola a tradução do
formato externo.

**Por quê.** O CSP do projeto restringe `connect-src` a `self`, então o navegador não pode
chamar a API externa direto — e é bom que não: a rota própria concentra permissão,
validação de CNPJ e tratamento de erro. Manter a tradução pura permite testar o formato da
BrasilAPI sem rede.

**Consequência.** É uma dependência externa **opcional**: se a BrasilAPI estiver fora do ar,
o cadastro continua funcionando à mão (aviso, sem bloquear o salvamento). A base é
configurável por `CNPJ_API_URL`. O preenchimento é auxiliar — a pessoa confere antes de
salvar.

---

## ADR-16 — Versão da aplicação no build (semver + SHA), visível em todo lugar

**Contexto.** A primeira versão foi para produção e é preciso saber, sem abrir o servidor,
qual versão está no ar — para correlacionar um comportamento relatado com o deploy que o
introduziu.

**Decisão.** No build, `next.config.ts` compõe
`APP_VERSION = <semver do package.json>+<SHA curto>` e injeta `NEXT_PUBLIC_APP_VERSION`,
`NEXT_PUBLIC_GIT_SHA` e `NEXT_PUBLIC_BUILD_TIME`. A versão aparece em: `/api/health`,
cabeçalho `X-App-Version` de toda resposta, rodapé da sidebar e `AuditLog.appVersion`.

**Por quê.** O `.dockerignore` exclui `.git`, então dentro da imagem não há repositório para
descobrir o commit: o SHA chega como **build arg** `GIT_SHA`. Sem ele, cai em `unknown` e o
semver continua legível. O semver vem do `package.json` (bump manual por release); o SHA é
automático por build. Gravar a versão em cada `AuditLog` responde "em que versão isso
aconteceu".

**Consequência.** Bumpar o `package.json` a cada release é disciplina humana; o resto é
automático. Rodar o Docker sem `--build-arg GIT_SHA` deixa o commit como `unknown` (a versão
semver e a data continuam corretas).

---

## ADR-17 — Patrimônio: posse não é propriedade, e série implica bem

**Contexto.** O estoque controla quantidade, não identidade: dois notebooks do mesmo modelo são
uma linha de `StockLevel`. Os itens tecnológicos precisam de número de patrimônio, dono e
histórico, e a T.I. e o almoxarifado precisam olhar o **mesmo** bem — não dois cadastros.

**Decisão.** Três regras de produto, confirmadas pelo dono:

1. **Posse não é propriedade, nem saída de estoque.** Atribuir um bem a uma pessoa muda o
   `AssetStatus` para `IN_USE` mas **não** gera `ISSUE`: o bem continua sendo da unidade e volta
   quando o responsável é desligado. Nenhuma transição de patrimônio toca `StockLevel`.
2. **Etiqueta global e legível.** O número é único no sistema (`PAT-000123`, gerado pelo
   servidor) e a tela o mostra agrupado (`PAT 000 123`).
3. **Série implica patrimônio, com exceção manual.** Material com `hasSerialControl` gera bem por
   padrão; `Item.trackAsAsset = false` diz que aquele material **não** é bem.

**Por quê.** Tratar a posse como saída faria o saldo parecer consumido por equipamento que apenas
está na mesa de alguém; um número de patrimônio digitado à mão nasce inconsistente; e presumir que
toda série é patrimônio evita uma decisão por item na doca, deixando o "não" para quando o
almoxarifado realmente quiser.

**Consequência.** Um bem em posse não aparece como disponível, mas segue no patrimônio da unidade;
o histórico (`AssetEvent`) é append-only, com trigger que recusa alteração e apagamento direto. O
chamado de TI se liga ao bem pelo número de patrimônio (abre em `IN_MAINTENANCE`, encerra
devolvendo ao estado anterior). O bem muda de unidade pela ficha, indo para o almoxarifado de
outra filial — sem tocar no saldo do material, que tem o seu próprio fluxo de transferência.

---

## ADR-18 — Imagem de produção: GHCR, tag imutável, scan e assinatura

**Contexto.** O mantenedor é único e o projeto tem que durar. A dúvida inicial era usar o Docker
Hub em vez do GHCR, por familiaridade. O registro, porém, **não** é o que torna uma imagem
segura — e o repositório já havia decidido construir no CI e publicar no GHCR (`ADR` do CI/CD).

**Decisão.**

1. **Registro: GHCR.** Sem conta adicional, sem credencial extra, sem rate limit de pull de
   terceiro; o push usa o `GITHUB_TOKEN` e o Dokploy puxa com um PAT `read:packages`.
2. **Produção aponta para a tag imutável `vX.Y.Z`**, nunca `latest` (que existe só para preview).
   O próprio workflow reescreve a imagem da Application (`application.saveDockerProvider`) antes
   de deployar, porque o Dokploy não adivinha a tag.
3. **Portão antes do deploy:** job `verify` (typecheck + `test`) precede o build; o `Trivy` falha
   em `CRITICAL`/`HIGH` (`ignore-unfixed`) e o deploy depende dele.
4. **Assinatura e procedência:** cosign **keyless** (OIDC) + `attest-build-provenance`.
5. **Base pinada por digest** (`node:24-bookworm-slim@sha256:…`) com **Dependabot** para o bump.

**Por quê.** O que protege é o que está **dentro** da imagem e como ela é verificável, não onde o
artefato mora. E, para um mantenedor único, automatizar o disparo **e** a conferência do
`/api/health` é mais seguro do que depender de lembrar de clicar.

**Consequência.** O deploy automático exige dois secrets a mais no GitHub (`GHCR_USERNAME` e
`GHCR_TOKEN`). O Dokploy, por ser Docker e não Kubernetes, **não** tem admissão de assinatura
nativa: a verificação vive no CI e no GHCR privado — não se promete um portão de assinatura no
servidor que ele não tem.
