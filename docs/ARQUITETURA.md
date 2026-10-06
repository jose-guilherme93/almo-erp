# Arquitetura — almoço-erp

> Documento de referência do domínio. Se uma regra de negócio está aqui, ela é a verdade.
> Mudou? Atualize este arquivo no mesmo commit da mudança.

---

## 1. Visão do domínio

```
                    ┌─────────────────────────────┐
                    │           MATRIZ            │
                    │  consolida, transfere,      │
                    │  define mínimos, audita     │
                    └──────────────┬──────────────┘
                                   │ transferências
        ┌──────────────┬───────────┴─────────┬──────────────┐
        │              │                     │              │
   ┌────▼────┐    ┌────▼────┐          ┌─────▼──┐     ┌────▼────┐
   │ Filial A│    │ Filial B│          │Filial C│     │ Filial D│
   │almox.   │    │almox.   │          │almox.  │     │almox.   │
   └────┬────┘    └────┬────┘          └────┬───┘     └────┬────┘
        │              │                    │              │
   usuários        usuários             usuários        usuários
   próprios        próprios             próprios        próprios
  (local           (locais,             (locais,        (locais,
   apenas)        Via transfer)        Via transfer)    Via transfer)
```

- **Filial** = unidade operacional com CNPJ, endereço, responsáveis e almoxarifado próprios.
- **Matriz** é apenas uma filial com `type = MATRIX` e permissões de rede.
- **Almoxarifado local** = conjunto de `StorageLocation` dentro da filial.
- Nenhuma filial enxerga dados de outra, exceto visões consolidadas da matriz.

> **Empresa e unidade são a mesma entidade — não há dimensão de grupo.** Cada `Branch`
> tem o próprio CNPJ; a matriz é uma filial com `type = MATRIX`. O modelo `Company`
> existe no schema apenas como rótulo jurídico criado pelo seed: não tem CRUD, não tem
> regra de negócio, e `Branch.companyId` é um agrupamento opcional que a operação não
> usa. Quem enxerga a rede é o **papel** com escopo `ALL_BRANCHES`, não o tipo da filial.
> Decisão registrada em `DECISOES.md` (ADR-14).

---

## 2. Cadastro de filial (completo)

`Branch` guarda, em campos próprios, tudo que o cadastro exige:

**Identificação** — `code` (código único, ex. `MAT`, `FIL-SAO-01`), `name`, `type`,
`legalName`, `tradeName`, `cnpj`, `stateRegistration`, `cnae`, `active`.

**Endereço** — `zipCode`, `street`, `number`, `complement`, `district`, `city`, `state`,
`country`, `latitude`, `longitude`.

**Contato** — `email`, `phone`, `whatsapp`.

**Responsáveis** — `legalResponsibleName`, `legalResponsibleDocument`,
`warehouseResponsibleId` (usuário responsável pelo almoxarifado),
`notificationResponsibleId` (quem recebe o alerta de novos chamados),
`defaultApproverId` (quem aprova solicitação por padrão).

**Operação** — `businessHours` (json), `notes`.

**Governança** — `parentId` (hierarquia), `createdAt`, `updatedAt`.

Regras:

- `code` é único e imutável após o primeiro uso em documento.
- CNPJ e CEP são validados e normalizados (somente dígitos) com Zod.
- O CNPJ pode ser consultado na base pública (BrasilAPI) pelo botão **"Buscar dados"**:
  a consulta passa pelo servidor (CSP restringe `connect-src` a `self`) e exige
  `filial:create`/`filial:manage`; a base é configurável por `CNPJ_API_URL`.
- Ao desativar uma filial (`active = false`), ela **não** aceita novas solicitações nem
  movimentações, mas continua legível para auditoria.
- Filiais com transferência pendente são bloqueadas para desativação.
- Todo cadastro tem `AuditLog` de criação/alteração.

---

## 3. Papéis e permissões

### 3.1 Estrutura

`User` (identidade global) → `Membership` (vínculo) → `Branch` + `Role` → `Permission`.

Um usuário pode ter **várias** memberships: almoxarife em 3 filiais, gestor em 1.
A sessão carrega o **contexto ativo** (filial + papel) e permite trocar por um seletor na topbar.

### 3.2 Papéis padrão (seed)

| Papel | Escopo | Resumo |
|---|---|---|
| `SUPER_ADMIN` | global | tudo; único que gerencia políticas de e-mail e papéis |
| `ADMIN_MATRIZ` | matriz (visão de rede) | filiais, mínimos, transferências, estoque consolidado, aprova Anything da rede |
| `ADMIN_FILIAL` | filial | itens locais, usuários da filial, aprova/entrega, inventário |
| `GESTOR` | filial | aprova/rejeita solicitações, aprova transferências recebidas, relatórios da filial |
| `ALMOXARIFE` | filial | entradas, saídas, ajustes, **cadastra o material que chega lendo o código de barras**, cria/envia transferências, recebe, entrega, inventário |
| `TI` | filial | atende os chamados de TI e as etapas encaminhadas ao setor; sem visão geral do almoxarifado |
| `SOLICITANTE` | filial | cria e acompanha **apenas** solicitações próprias; sem estoque, transferências nem catálogo |
| `CONSULTA` | filial | leitura |

### 3.3 Catálogo de permissões

Formato `<recurso>:<ação>`.

```
filial:read            filial:create         filial:update        filial:manage
local:read             local:manage
categoria:read         categoria:manage
unidade-medida:read    unidade-medida:manage
item:read              item:create           item:update          item:manage
estoque:read           estoque:entrada       estoque:ajuste       estoque:saida
transferencia:read     transferencia:create  transferencia:enviar transferencia:receber
solicitacao:read       solicitacao:overview  solicitacao:create   solicitacao:approve
solicitacao:entregar
manutencao:read        manutencao:overview   manutencao:create    manutencao:atender
manutencao:delegar     manutencao:manage
inventario:read        inventario:manage
relatorio:read
setor:read             setor:manage
usuario:read           usuario:manage
papel:read             papel:manage
politica-email:read    politica-email:manage
notificacao:read
configuracao:manage
```

`*:overview` significa "ver todo o escopo de filiais". Sem ela, o usuário só
enxerga o que é dele ou o que foi encaminhado ao seu setor (ver §3.5).

Papéis são **dados**, editáveis na tela de administração. Adicionar papel novo não exige deploy.

### 3.4 Escopo

- `SUPER_ADMIN` e `ADMIN_MATRIZ` têm `scope = ALL_BRANCHES`.
- Os demais têm `scope = OWN_BRANCHES` e só acessam `branchId ∈ ctx.branchIds`.
- Toda verificação passa por `requireBranch(branchId)`, que compara com `ctx.branchIds`.
- Ações destrutivas exigem permissão de `manage` **e** re-autenticação só na Fase 13 (opcional).

### 3.5 Setores, visibilidade e encaminhamento de etapas

**Setor** (`Sector`) é a dimensão organizacional: Financeiro, Pedagógico, RH
(pedem), Almoxarifado, Manutenção, TI (atendem; a TI também pede). O setor mora
no vínculo do usuário (`Membership.sectorId`), pré-seleciona o setor na abertura
e viaja na demanda (`Request.sectorId`, `MaintenanceRequest.sectorId`).

Regra de visibilidade (a barreira anti-vazamento do §3.2 aplicada à demanda):

| Quem | O que enxerga |
|---|---|
| Solicitante puro | **só** o que ele mesmo pediu |
| Setor de atendimento sem `*:overview` | o próprio, o atribuído, o **encaminhado ao seu setor** e o **roteado ao seu setor de atendimento** (`serviceSectorId`), sempre dentro das filiais a que tem acesso |
| Com `solicitacao:overview` / `manutencao:overview` | todo o escopo de filiais do fluxo |
| Matriz / `SUPER_ADMIN` | rede inteira |

**Encaminhamento de etapa** (`Delegation`): o almoxarifado pode delegar uma fase
de uma demanda a outro setor ("analisar se o defeito é de fabricação ou mau
uso") e a TI responde com um **laudo**. Enquanto a etapa está aberta
(`PENDING → ACCEPTED → IN_PROGRESS`), quem responde é o setor de destino; ao
concluir (`COMPLETED`) com laudo, o comando **volta** para o setor de origem, que
encerra a etapa (`RETURNED`) e segue até fechar a demanda. Uma delegação aponta
para **uma** solicitação **ou** um chamado, nunca os dois.

Toda transição gera `DelegationEvent`, `AuditLog` e notificação endereçada ao
**setor** (não à pessoa), na mesma transação.

---

## 4. Autenticação e regra de e-mail

### 4.1 Fluxo

```
Usuário clica "Entrar com Google"
  → Google autentica
  → authorize() [Auth.js]
      1. email com domínio corporativo?  (EmailPolicy ativa OU .env AUTH_ALLOWED_DOMAINS)
      2. existe User com status = ACTIVE no banco?   (conta pré-aprovada por admin)
      3. user sem Membership? → cria membership padrão (CONSULTA) na filial padrão
  → sessão criada com userId, status, memberships
  → proxy.ts (gate grosso): existe sessão?  senão /login
  → layout de (app): getAuthContext() relê o banco e valida status ACTIVE
```

Falhas produzem `/acesso-negado` com motivo legível e contato do administrador — nunca um erro 500.

### 4.2 `EmailPolicy` (extensibilidade futura)

```
EmailPolicy
  id, domain (único, minúsculo), pattern (regex opcional, null = sem regex),
  autoApprove (bool), defaultRoleId, defaultBranchId, active, createdAt
```

- `domain` obrigatório → checagem de domínio corporativo.
- `pattern` opcional → regra por e-mail (ex.: `^.*\+filial[a-z]+@`). Implementar e testar.
- `autoApprove = true` → cria o `User` como `ACTIVE` no primeiro login (convite aberto).
- `autoApprove = false` → primeiro login gera `User` como `PENDING` + `Invite` aguardando
  aprovação de `SUPER_ADMIN`, e dispara `ACCESS_REQUESTED`.

### 4.3 Status de usuário

`PENDING` (aguardando aprovação) · `ACTIVE` · `SUSPENDED` (sessão invalidada) · `INACTIVE`.

Suspensão é efetiva no próximo request porque `getAuthContext()` relê o status no banco
(`SessionProvider` não é usado como fonte de autorização; o JWT é apenas um preâmbulo).

### 4.4 Google Workspace

O provider usa `hd` (hosted domain) quando o domínio vem do token. `hd` **não** é
confiável como autorização — a checagem real é sempre a de `EmailPolicy`/tabela de usuários.

### 4.5 Login local (e-mail + senha)

Segunda porta de entrada, para operar o ERP **sem Google** (é o caminho de
bootstrap de uma instalação nova).

```
Usuário informa e-mail + senha em /login
  → provider `local` (Auth.js Credentials)
      1. auth.localLogin.enabled está ligado?            (Config)
      2. e-mail não está bloqueado por tentativas?        (LoginThrottle)
      3. existe User ACTIVE e ativo, com passwordHash?
      4. a senha confere?  (scrypt, tempo constante)
  → signIn: resolveLocalLogin() reafirma status e grava lastLoginAt
  → sessão JWT igual à do Google
```

Diferenças conscientes em relação ao Google:

- **Não** aplica a regra de domínio corporativo. A conta é criada por um
  administrador (ou pelo seed) — pode ser de qualquer domínio, inclusive pessoal.
- **Não** auto-provisiona `User` nem `Membership`: quem cria é o administrador.
- Freio de força bruta por e-mail em `LoginThrottle` (5 falhas → 15 min), com a
  decisão pura em `src/lib/login-throttle.ts` e o acesso a dados em
  `src/server/auth/throttle.ts`.
- Mensagens de erro são genéricas ("E-mail ou senha inválidos"): não revelam se
  a conta existe.

O liga/desliga vive em `Config` (`auth.localLogin.enabled`, `auth.google.enabled`),
editável em `/admin/configuracoes`. Sem credencial Google (`AUTH_GOOGLE_ID`/
`AUTH_GOOGLE_SECRET`), o default do Google é desligado e o botão fica inerte.

---

## 5. Estoque

### 5.1 Documento de movimentação

`StockDocument` (cabeçalho) + `StockLine` (linhas). Tipos:

| Tipo | Efeito no saldo | Quem cria |
|---|---|---|
| `INBOUND` (entrada) | + | ALMOXARIFE, ADMIN_FILIAL |
| `ISSUE` (saída por entrega) | − | automático ao concluir entrega |
| `ADJUSTMENT` (ajuste) | ± | ALMOXARIFE, ADMIN_FILIAL — exige justificativa |

O leitor de código de barras (`src/components/domain/barcode-scanner.tsx`) é carregado sob demanda
e é **JavaScript puro** — o `@zxing/browser` não usa WebAssembly, então a CSP não precisa de
`wasm-unsafe-eval`. `getUserMedia` só existe em contexto seguro (HTTPS ou localhost) e pode ser
negado; por isso a entrada manual é o caminho de fallback, não um extra. O stream só é pedido
**depois** que o `<video>` está montado.
| `TRANSFER_OUT` | − na origem | automático ao enviar transferência |
| `TRANSFER_IN` | + no destino | automático ao receber transferência |
| `RETURN` (devolução) | + | GESTOR, ADMIN_FILIAL |
| `INVENTORY` (contagem) | ± | automático ao fechar inventário |

Campos do cabeçalho: `number` (sequencial por filial, ex. `MV-2026-000123`), `type`, `branchId`,
`storageLocationId`, `date`, `notes`, `referenceType`, `referenceId`, `status`
(`DRAFT` | `POSTED` | `CANCELLED`), `postedAt`, `createdById`.

Regra: documento `POSTED` é **imutável**. `CANCELLED` gera documento inverso, nunca delete.
Documento gerado por um fluxo de negócio (`referenceType` em `REQUEST`/`TRANSFER`/`INVENTORY`)
**não** pode ser cancelado por fora: o estorno precisa reconciliar a entidade de origem e
por isso acontece no fluxo dela. Só lançamentos avulsos (entrada/ajuste sem vínculo) são
canceláveis diretamente.

### 5.1.1 Concorrência

Toda alteração de saldo passa por `lockStockLevels`/`lockItemLevels` (`SELECT … FOR UPDATE`,
ordem determinística). Além disso, as transições de `Transfer` e `InventorySession` travam a
própria linha antes de decidir (`lockFlowRow`), e a reserva trava o saldo do item antes de
escolher a prateleira — sem isso, duas operações simultâneas super-reservam ou movimentam o
estoque duas vezes. O banco reforça com `CHECK (quantity >= 0)`, `CHECK (reserved_quantity >= 0)`
e `CHECK (reserved_quantity <= quantity)` em `stock_levels`.

### 5.2 Saldo

`StockLevel` = `itemId + storageLocationId + branchId` com `quantity`, `reservedQuantity`,
`averageCost`, `version`, `lastMovementAt`.

`available = quantity − reservedQuantity`. Saída só é permitida sobre `available`.

Cálculo transacional (Pseudocódigo):

```
transaction:
  level = SELECT ... FOR UPDATE WHERE item/location
  if (op == IN)        level.quantity += qty
  if (op == OUT)       if (level.available < qty) throw InsufficientStockError
                       level.quantity -= qty
  recompute averageCost (média ponderada) quando op == IN
  level.version += 1
  insert StockLine (append-only)
```

### 5.3 Reserva

`StockReservation` liga `requestLineId` a `stockLevelId` com `quantity`, `lotId` (material
controlado por lote) e `status` (`ACTIVE` | `RELEASED` | `CONSUMED`). Criada na **aprovação**,
consumida na **entrega**, liberada em rejeição/cancelamento. Impede aprovar o que não existe.

Para material **controlado por lote**, a reserva escolhe o lote por **FEFO** (vence primeiro
sai primeiro) e confere a quantidade do lote contra o próprio `StockLine`. A entrega usa o
lote reservado; não há saldo por lote em `StockLevel` (dívida técnica registrada).

### 5.4 Mínimo e alerta

`ItemStockPolicy` (item + filial) define `minimumQuantity`, `maximumQuantity`, `alertQuantity`.
Ao `POSTED` um documento, verifica-se o mínimo e dispara `STOCK_BELOW_MIN` (com
**deduplicação**: só notifica se não existe não-lida igual nos últimos 7 dias).

### 5.5 Transferência

`Transfer` + `TransferLine`.

```
DRAFT ──enviar──▶ SENT ──despachar(opcional)──▶ IN_TRANSIT
                  │  (gera TRANSFER_OUT na origem)
                  └──receber direto──▶ RECEIVED   (gera TRANSFER_IN no destino)
IN_TRANSIT ──receber──▶ RECEIVED
           ──devolver─▶ RETURNED
DRAFT/SENT ──cancelar─▶ CANCELLED
```

- `quantityReceived` pode ser menor que `quantitySent` → **recebimento parcial**: o material
  que chegou entra no destino e a transferência permanece `IN_TRANSIT`; o pendente pode ser
  recebido depois ou devolvido (`RETURNED`) manualmente.
- O despacho (`IN_TRANSIT`) é opcional: dá para receber direto de `SENT`.
- Material controlado por lote: o envio escolhe o lote por FEFO e o registra na
  `TransferLine`; recebimento, devolução e cancelamento usam o mesmo lote.
- Bloqueia saldo na origem ao `SENT` (reserva de transferência) ou baixa imediata:
  escolha **baixa imediata** em `SENT` e registre o documento; a reserva de estoque da
  solicitação é outro conceito e não se mistura.
- Quem envia: `ALMOXARIFE`/`ADMIN_FILIAL` na origem. Quem recebe: `ALMOXARIFE`/`GESTOR`/`ADMIN_FILIAL`
  no destino. Notificação `TRANSFER_SENT` para todos os receptores do destino.

---

### 5.1.2 Entrada pela doca (código de barras)

O caminho principal de insumo não tem cadastro prévio. Em `/estoque/entradas/nova`, o
`ItemCombobox` lê o código de barras com a câmera (ou o usuário digita) e resolve em três
desfechos:

| Situação | O que acontece |
|---|---|
| Código pertence a um material | a linha entra montada; o usuário só informa quantidade e custo |
| Código sem material, usuário tem `item:create` | abre o cadastro mínimo **na própria tela** (nome + unidade); ao salvar, o material é criado e a linha entra |
| Código sem material, usuário sem `item:create` | recusa com mensagem; o solicitante não cadastra catálogo |

O material nascido da doca entra na categoria **"Geral"** (`code = GERAL`), criada sob demanda por
`ensureGeneralCategory()`. `Item.categoryId` continua obrigatório no banco — a categoria é
organização, não requisito de entrada, e ninguém escolhe categoria no caminho principal. O SKU é
gerado pelo servidor a partir do prefixo da categoria (`GERAL-0001`). Tudo o que a doca não
preenche (preço, descrição, lote, validade, série) fica no padrão e é editável depois na tela do
material.

Categoria "Geral" **não exige aprovação**: o pedido continua passando pela fila de quem responde
(§3.5), só sem um clique extra de portão.

Toda unidade criada pela interface nasce com o local `ALMOX — Almoxarifado Central`, para que a
primeira entrada não dependa de um cadastro de local escondido na aba do cadastro da unidade.

## 6. Solicitação de materiais

`tela: /solicitacoes/nova` — **qualquer usuário logado** com membership ativa pode abrir.

```
DRAFT ──enviar──▶ SUBMITTED ──assumir──▶ IN_REVIEW
                                   └─▶ (sem claim: fica na fila da filial)
IN_REVIEW ──aprovar tudo──▶ APPROVED
          ──aprovar parcial─▶ PARTIALLY_APPROVED
          ──rejeitar───────▶ REJECTED
APPROVED / PARTIALLY_APPROVED ──separar──▶ IN_PREPARATION
                                   ──entregar─▶ DELIVERED
DRAFT ──cancelar──▶ CANCELLED
```

Regras:

- `Request`: `number` (`SOL-2026-000045`), `branchId`, `requesterId`, `status`, `priority`
  (`LOW` | `NORMAL` | `HIGH` | `URGENT`), `neededAt`, `notes`, `rejectionReason`,
  `responsibleId` (quem responde), `claimedById`, `claimedAt`, `decidedById`, `decidedAt`.
- `RequestLine`: `itemId`, `requestedQuantity`, `approvedQuantity`, `deliveredQuantity`,
  `unitPriceSnapshot`, `lineNotes`.
- `PARTIALLY_APPROVED` exige justificativa por linha não aprovada.
- `URGENT` muda a cor e a ordenação da fila, não pula aprovação.
- Timeline `RequestEvent` para toda transição, com autor, de→para e comentário.
- Itens sem `available >= requestedQuantity` são sinalizados na criação, mas **não bloqueiam**;
  a indisponibilidade é resolvida na aprovação (parcial) ou por transferência.
- `Delivery`: uma por request, com `deliveredAt`, `deliveredById`, `receivedByName`,
  `receivedByDocument`, `signature` (canvas ou aceite por nome), e `StockDocument` de saída gerado.
  Itens reservados em prateleiras diferentes geram **um `ISSUE` por local** (o saldo é por
  local); material controlado por lote sai do lote reservado na aprovação.
- `sectorId` (setor de quem pediu) e `serviceSectorId` (almoxarifado por padrão).
  O **encaminhamento de uma etapa** para outro setor está em §3.5.
- Busca e escopo de filial são combinados com `AND`; o termo buscado nunca amplia o
  escopo visível (a barreira anti-vazamento do §3.2 vale também para a busca).
- `Attachment`: imagens do pedido. Compressão no navegador (WebP, ≤1600px), arquivo
  em disco, download por route handler autenticado com a visibilidade da demanda.

### Chamados de reparo (`MaintenanceRequest`)

O mesmo modelo atende **manutenção** e **TI**: `category = IT` roteia para o setor
TI, as demais categorias para a Manutenção (`serviceSectorId`). O ciclo é
`OPEN → IN_REVIEW → IN_PROGRESS → WAITING_PARTS → DONE` (mais `REJECTED`/`CANCELLED`),
e a pessoa que atende pode ser de qualquer setor de serviço. A prioridade continua
sendo definida por quem recebe (`AGENTS.md` §3.7).

O chamado nasce com o `serviceSectorId` do setor que atende e a notificação de
abertura vai para **esse setor na filial** (não para todo `manutencao:atender`).
Quem atende enxerga o chamado roteado ao seu setor mesmo antes de ser atribuído.
A home de quem atende um setor de serviço (tem `manutencao:atender`, não aprova
nem entrega) é a fila `/reparos`, com os abertos por padrão.

### Aprovação e responsabilidades

- Ao enviar, `resolveRecipients(REQUEST_CREATED)` notifica o `defaultApproverId` da filial e
  todos com `solicitacao:approve` na filial. A solicitação entra na **fila** do dashboard da unidade.
- O primeiro a abrir a fila vira `claimedById` (evita dois aprovadores no mesmo pedido).
- Se o aprovador não agir, a solicitação reaparece na fila após o SLA (configurável em `Config`).

---

## 7. Notificações — regras de fan-out

Fonte única: `src/server/services/notificacao/rules.ts`. Cada tipo declara o resolver.

| Tipo | Destinatários |
|---|---|
| `REQUEST_CREATED` | `defaultApproverId` + todos com `solicitacao:approve` na filial + papéis de **escopo de rede** com `solicitacao:approve` (exceto o autor) |
| `REQUEST_CLAIMED` | demais aprovadores da filial + papéis de escopo de rede (saiu da fila) |
| `MAINTENANCE_CREATED` | setor de atendimento do chamado (`serviceSectorId`, resolvido pela categoria) que tem `manutencao:atender` **na filial** + papéis de rede + responsável por notificações da filial; se o setor não tiver ninguém na unidade, cai em quem tem `manutencao:atender` na filial |
| `MAINTENANCE_ASSIGNED` | `assignedToId` |
| `MAINTENANCE_PRIORITY_SET` / `MAINTENANCE_DONE` | `requesterId` |
| `REQUEST_APPROVED` / `PARTIALLY_APPROVED` / `REJECTED` | `requesterId` |
| `REQUEST_DELIVERED` | `requesterId` + `responsibleId` |
| `TRANSFER_SENT` | `ALMOXARIFE`/`GESTOR`/`ADMIN_FILIAL` do destino |
| `TRANSFER_RECEIVED` | `ALMOXARIFE`/`ADMIN_MATRIZ` da origem |
| `STOCK_BELOW_MIN` | `ALMOXARIFE` + `ADMIN_FILIAL` da filial (deduplicado) |
| `INVENTORY_DIVERGENCE` | `ADMIN_FILIAL` + `ADMIN_MATRIZ` |
| `ACCESS_REQUESTED` | todos `SUPER_ADMIN` |
| `ACCESS_GRANTED` | o próprio usuário |
| `DELEGATION_REQUESTED` | usuários do setor de destino **na filial da demanda** |
| `DELEGATION_ACCEPTED` / `COMPLETED` / `RETURNED` | usuários do setor de origem **na filial da demanda** |

Regras comuns:

- Criadas na **mesma transação** do evento.
- Excluem o `actorId` quando o ator é o alvo natural.
- Sempre com `entityType` + `entityId` + `link` para deep link.
- Notificação por setor é sempre **restrita à filial da demanda** — o setor é
  global, mas a demanda não.
- `STOCK_BELOW_MIN` deduplicado (7 dias).

---

## 8. Dashboards

### 8.1 `/dashboard` — Admin da matriz

Cards: valor total de estoque; itens abaixo do mínimo (rede); solicitações pendentes por status;
idade média da solicitação (SLA em risco); transferências em trânsito; movimentações do mês
(entradas × saídas); top 10 itens por consumo; valor de estoque por filial (gráfico);
filiais com maior pendência. Tabela de unidades com drill para `/dashboard/unidade/[id]`.

### 8.2 `/dashboard/unidades` — Admin da matriz

Uma linha por filial: pendências, mês em curso, valor de estoque, % de itens no mínimo,
última movimentação, responsável. Ordenável e filtrável.

### 8.3 `/dashboard/unidade/[branchId]` — Admin da unidade

- Topo: **alertas de chamados** (solicitações que precisam de resposta agora) e sino de
  não lidas. É aqui que a notificação de nova solicitação aparece.
- Fila de aprovação com `SUBMITTED` e `IN_REVIEW`, ordenada por prioridade e tempo parado.
- Solicitações aguardando separação (`APPROVED`/`PARTIALLY_APPROVED`).
- Entregas pendentes, inventário em aberto, transferências a receber/enviar.
- Indicadores da filial: saldo por categoria, itens no mínimo, consumo do mês.

### 8.4 `/meu` — qualquer usuário

Minhas solicitações com status, histórico de entregas, e atalho para `/solicitacoes/nova`.

### 8.5 Contrato de escopo

Cada agregação declara `scope: "ALL_BRANCHES" | "OWN_BRANCHES"` e é implementada em
`src/server/services/dashboard/`. Duas telas nunca recalculam o mesmo número por caminhos
diferentes.

**Todo número do dashboard abre a lista que o originou.** Os indicadores que apontam para
uma listagem passam o filtro correspondente na URL (`?filial=<id>`, `?emTransito=1`,
`?relatorio=…`). Sem filial, quem tem escopo de rede vê todas as unidades nas listas
(`listApprovalQueue`, `listPendingDeliveries`, `listTransfers`) e os demais caem na filial
ativa — o mesmo critério da contagem. Indicador que não tem lista equivalente não recebe
link.

---

## 9. Mapa de rotas

| Rota | Permissão mínima | Perfis |
|---|---|---|
| `/login` | — | público |
| `/acesso-negado` | — | público |
| `/dashboard` | `relatorio:read` + escopo rede | SUPER_ADMIN, ADMIN_MATRIZ |
| `/dashboard/unidades` | `filial:read` + escopo rede | SUPER_ADMIN, ADMIN_MATRIZ |
| `/dashboard/unidade/[branchId]` | `solicitacao:approve` | ADMIN_FILIAL, GESTOR, SUPER_ADMIN, ADMIN_MATRIZ |
| `/solicitar` | `solicitacao:create` ou `manutencao:create` | qualquer logado — escolha entre material e reparo |
| `/solicitacoes/nova` | `solicitacao:create` | qualquer logado |
| `/reparos` | `manutencao:read` | dono e setor de atendimento (ver §9.2) |
| `/reparos/novo` | `manutencao:create` | qualquer logado |
| `/reparos/[id]` | `manutencao:read` | dono, setor de atendimento, gestão da unidade |
| `/solicitacoes` | `solicitacao:read` | as próprias; com `solicitacao:overview`, todo o escopo |
| `/solicitacoes/fila` | `solicitacao:approve` | filial ativa; com escopo de rede, todas as unidades |
| `/solicitacoes/[id]` | `solicitacao:read` | dono, aprovadores da filial, matriz |
| `/solicitacoes/[id]/aprovar` | `solicitacao:approve` | aprovador da filial |
| `/entregas` | `solicitacao:entregar` | ALMOXARIFE, ADMIN_FILIAL, matriz |
| `/admin/auditoria` | `papel:manage` | SUPER_ADMIN |
| `/admin/configuracoes` | `configuracao:manage` | SUPER_ADMIN |
| `/estoque/saldos` | `estoque:read` | todos com membership |
| `/estoque/movimentacoes` | `estoque:read` | idem |
| `/estoque/entradas` | `estoque:entrada` | ALMOXARIFE+ |
| `/estoque/ajustes` | `estoque:ajuste` | ALMOXARIFE+ |
| `/transferencias` | `transferencia:read` | todos com membership |
| `/inventario` | `inventario:read` | ALMOXARIFE+ |
| `/catalogo/itens` | `item:read` | todos com membership |
| `/filiais` | `filial:read` | matriz (leitura), ADMIN_FILIAL (a sua) |
| `/notificacoes` | `notificacao:read` | qualquer logado |
| `/encaminhamentos`, `/encaminhamentos/[id]` | `manutencao:atender` | setor de origem e de destino |
| `/api/anexos/[id]` | visibilidade da demanda pai | quem enxerga a solicitação/chamado |
| `/relatorios` | `relatorio:read` | GESTOR+ |
| `/relatorios/consolidados` | `relatorio:read` | GESTOR+ (histórico de consolidações) |
| `/relatorios/consolidados/[id]` | `relatorio:read` | quem enxerga o snapshot |
| `/api/relatorios/[relatorio]/csv` | `relatorio:read` | GESTOR+ |
| `/api/relatorios/consolidados/[id]/csv` | `relatorio:read` | quem enxerga o snapshot |
| `/admin/usuarios` | `usuario:manage` | SUPER_ADMIN, ADMIN_FILIAL (escopo) |
| `/admin/papeis` | `papel:manage` | SUPER_ADMIN |
| `/admin/politicas-email` | `politica-email:manage` | SUPER_ADMIN |
| `/admin/configuracoes` | `configuracao:manage` | SUPER_ADMIN |

### 9.1 Navegação por tarefa

O menu lateral (`src/lib/navigation.ts`) não segue o modelo de dados nem ordem alfabética:
segue a ordem em que o trabalho acontece. Grupos, na ordem em que aparecem:

| Grupo | Itens |
|---|---|
| **Ação** | Aprovar pedidos · Entregar · Chamados abertos |
| **Insumo** | Registrar entrada · Ajustes · Inventário |
| **Consumo** | Pedidos de material · Fazer um pedido |
| **Manutenção** | Abrir chamado · Meus chamados |
| **Monitoramento** | Saldos · Movimentações · Relatórios · Dashboard (só rede) |
| **Configurações** | Materiais · Unidades · Usuários |
| **Avançado** | Transferências · Categorias · Unidades de medida · Perfis · Políticas de e-mail · Auditoria |

Regras de exibição:

- Todo item declara uma permissão mínima e **não aparece** sem ela (UX; a decisão real é do
  servidor).
- **Transferências só aparece com 2+ unidades ativas.** Numa instalação de uma unidade só não há
  o que transferir, e o item vira ruído.
- Nenhum `href` aparece em dois grupos — o mesmo endereço repetido é ruído.
- Telas de ajuste raro (Avançado) continuam acessíveis por URL e pelos links das próprias telas.

---

## 9.2 Chamados de reparo

Modelo próprio (`MaintenanceRequest`), separado da solicitação de material: um chamado
não tem itens nem estoque, é um pedido de serviço. Misturar os dois obrigaria a inventar
campos vazios nos dois lados.

```
OPEN ──assumir──▶ IN_REVIEW ──atribuir──▶ IN_PROGRESS ⇄ WAITING_PARTS ──▶ DONE
  │                    │
  └──recusar──▶ REJECTED   └──cancelar──▶ CANCELLED
```

Campos que existem por um motivo:

- `priority` é **nulo ao abrir**. Quem recebe classifica — quem abre não sabe o impacto
  na operação.
- `location` e `assetTag` fazem a equipe chegar no lugar certo sem ligar para perguntar.
- `resolutionHours` é calculado na conclusão e alimenta o tempo médio de atendimento.

Aparece no dashboard da unidade junto com a fila de aprovação, e no sino de quem atende.

## 10. Auditoria

`AuditLog`: `actorId`, `action`, `entityType`, `entityId`, `branchId`, `before` (json),
`after` (json), `ip`, `userAgent`, `createdAt`. Escrita em toda ação de escrita
(atributo `createdById` nas entidades já é obrigatório).

## 10.1 Observabilidade de erro

Auditoria responde "quem fez o quê". Ela **não** responde "quebrou alguma coisa?" — e essa era a
lacuna: um erro de render só existia como linha no stdout do container, sem busca e sem alerta,
enquanto o usuário via apenas `Referência: abc123` que ninguém conseguia decifrar.

`src/instrumentation.ts` (gancho `onRequestError` do Next) fecha o ciclo. Ele entrega erro de
**render**, **route** e **action**, com rota, método e — o detalhe que importa — o `digest`, que é
**o mesmo código que o usuário viu na tela**. Digitar o código em `/admin/erros` acha a linha.

`ErrorLog` (migration própria) guarda **uma linha por erro único**, não por ocorrência:

| Campo | Papel |
|---|---|
| `fingerprint` (único) | rota sem query + digest + mensagem normalizada |
| `count`, `firstSeenAt`, `lastSeenAt` | quantas vezes, desde quando |
| `digest` (indexado) | o código que o usuário relata |
| `routePath`, `routeType`, `method` | onde quebrou (`render`/`route`/`action`/`proxy`) |
| `message`, `stack` | o quê, com linha sensível omitida |
| `resolvedAt`, `resolvedById` | triagem: sai da fila sem apagar histórico |
| `actorId`, `branchId`, `appVersion` | quem viu, em qual release |

Quatro decisões que não são óbvias:

- **Deduplicar é obrigatório.** `fingerprint` é único e o repetido faz `count += 1`. Sem isso, um
  erro em render alcançado por dez usuários criaria dez linhas e a tela viraria parede.
- **Ruído é filtrado.** O Next emite `The destination stream closed early.` quando uma navegação RSC
  é abandonada (o usuário sai antes do stream terminar). Não é defeito, chega em volume alto e
  esconderia o erro real. `isIgnorableError` é uma lista curta e específica de propósito.
- **Query string fora.** O Next anexa `?_rsc=<hash>` a cada navegação, e o hash muda sempre; sem
  `normalizeRoutePath` a mesma tela viria uma linha nova por visita.
- **Recurso dinâmico fora.** Linha de stack ou mensagem que case
  `password|token|secret|cookie|cpf|cnpj` é substituída por marcador — credencial não vai para log.

**O registro no banco e o stdout são complementares.** `ErrorLog` vive no mesmo Postgres da
aplicação: se o banco cai, o registro cai junto — justo quando mais importa. Por isso o
`console.error` estruturado continua existindo, e `recordServerError` nunca propaga exceção.

**O alerta notifica só a primeira ocorrência.** Um erro que se repete 500 vezes continua sendo um
erro só; notificar cada vez transformaria o sino em ruído e esconderia o problema mais grave.

O **alerta** é a §10.2, junto com o funil.

---

## 10.2 O funil de incidentes

A §10.1 fechou o ciclo **dentro** do ERP: dá para descobrir o que quebrou. Faltava a pergunta
seguinte — o erro chega até mim sem que eu abra nada? E faltava a lacuna estrutural: com um
fornecedor só, trocar de fornecedor significava reescrever a instrumentação.

A resposta é o **funil**: um formato único de incidente e vários destinos, configurados por
variável de ambiente.

```
                      ┌─ error-log      sempre ligado · sem cota · dentro da VPS
dispatchIncident ─────┼─ better-stack   SDK do Sentry apontado para o DSN deles
                      └─ otel           pronto, desligado: é o caminho do Grafana
```

| Peça | Papel |
|---|---|
| `observability/index.ts` | tipo `Incident`, contrato `IncidentSink`, `dispatchIncident` |
| `observability/scrub.ts` | remoção de credencial e dado pessoal — **a única saída do processo** |
| `observability/ignorable.ts` | filtro de ruído do Next, numa lista só |
| `observability/alert.ts` | Telegram, com freio por rota+mensagem |
| `observability/retention.ts` | poda do `ErrorLog`, sem cron |
| `observability/report.ts`, `process-guards.ts` | relato de requisição e de erro fatal de processo |
| `sink-error-log.ts`, `sink-sentry.ts`, `sink-otel.ts` | um arquivo por destino |

Cinco decisões que não são óbvias:

- **A captação não conhece os destinos.** Por isso trocar de fornecedor — inclusive para um Grafana
  na própria VPS — é mudar variável de ambiente. O destino OTLP já está escrito e desligado, com
  teste de integração que sobe um servidor HTTP e prova que o evento chega no formato certo:
  descobrir porta fechada no dia da migração seria o pior momento possível.
- **O `ErrorLog` é o destino que nunca pode faltar.** Não depende de terceiro, não tem cota e não
  sai da VPS — é o que garante que o erro não se perca quando a cota do fornecedor acabar ou a rede
  cair. Por isso ele vem **primeiro** na lista.
- **A política de alerta mora no destino local**, não na instrumentação. "Erro novo" só existe
  depois do agrupamento por fingerprint, que é o que o `ErrorLog` faz. Assim o sino, o Telegram e a
  tela contam a mesma coisa: saem do mesmo `outcome`.
- **`runAction` foi para `src/server/actions/`.** Uma Server Action não propaga exceção: devolve
  `{ ok: false }` ao componente. O `onRequestError` só enxerga o que foi lançado na requisição, e o
  erro já tinha sido engolido antes — então os ~105 call sites em 21 arquivos eram a maior classe
  de erro invisível do sistema. `lib` não pode importar `server/` (§4), então mover a função foi o
  que permitiu ao relato conhecer o funil **sem** que nenhum call site mudasse: só a linha de
  import de cada arquivo.
- **Erro de cliente não escreve no banco.** O que vem do navegador é entrada não confiável; gravar
  no `ErrorLog` abriria a tela de observabilidade para injeção de dados falsos. Vai direto ao
  destino externo, que tem cota, filtro e `beforeSend`.

### Porta de dado pessoal

`scrub.ts` é a barreira LGPD, e é a **única** saída do processo — um sink novo que esqueça de
chamar `scrubIncident` vazaria, e a falha só apareceria em produção. Remove senha, token, cookie,
`authorization`, JWT, hex longo, credencial em URL, **CPF, CNPJ e e-mail**, inclusive em texto
solto (onde não há nome de campo para filtrar). Descarta a query string, que em tela de relatório
carrega filtro de pessoa. A régua é larga demais de propósito: melhor perder um campo útil do que
deixar vazar um CPF.

Uma lição que veio da execução: a §10.1 tinha a **sua própria** regra de remoção, e ela descartava
a linha inteira ao ver a palavra "CPF" — matando o diagnóstico junto. Duas regras divergem, e a
divergência aparece como vazamento. Agora há uma, e `error-log.ts` reexporta dela.

### A borda da edge

`instrumentation.ts` roda em **dois** runtimes, e a edge não tem Prisma nem `node:crypto`. Tudo
que depende de Node entra por `import()` dinâmico **guardado por `NEXT_RUNTIME === "nodejs"`** — o
guard é o que permite ao compilador eliminar o código na build da edge. Sem ele, o Turbopack
inclui o cliente de banco no bundle da edge e a aplicação quebra ao subir, não no relatório de
erro. `pnpm build` precisa sair com **zero** aviso de Edge Runtime; é esse o teste.

### Retenção

Poda agendada exigiria worker, `cron` do Dokploy ou um agendador no boot — nenhum vale o custo de
operação para apagar linha velha. O `ErrorLog` é escrito quando acontece um erro, e erro é raro em
sistema saudável, então a poda roda junto, no máximo uma vez por hora, por processo. Só leva o que
é resolvido **e** não volta há 90 dias — erro resolvido que continua voltando tem o `lastSeenAt`
atualizado e sobrevive, que é o comportamento correto — e um teto absoluto corta do mais antigo
para o mais novo, porque quando o sistema está quebrando o erro de agora vale mais que o de ontem.

### Alerta que não precisa de plano pago

O plano gratuito do Better Stack **não** integra Telegram: o alerta sai do plano pago. Como este
projeto roda numa VPS de 2 vCPU e não pode pagar, o aviso sai de código próprio — e sai de graça,
porque Telegram também é. Um alerta que derruba a requisição que já estava falhando troca um erro
visível por dois invisíveis, então `sendAlert` nunca lança; e um alerta que enche o chat esconde o
incidente seguinte, então há freio de 15 min por rota+mensagem.
---

## 11. Relatórios consolidados e exportação

`runReport(reportId, scope)` devolve `{ headers, rows, summary }` — a **mesma**
consulta alimenta a tela, o CSV e a consolidação, sem duas implementações que
possam divergir. Todo relatório respeita o escopo de filial do usuário.

### 11.1 Consolidação é congelamento

Consolidar (`/relatorios` → *Consolidar e imprimir (PDF)*) grava um
`ReportSnapshot`: os dados, o filtro, o escopo, o autor e um `contentHash`
(SHA-256 canônico). O snapshot é **append-only**:

- a aplicação não expõe update/delete de snapshot;
- o banco recusa `UPDATE`/`DELETE` em `report_snapshots` (trigger na migration);
- a tela de consolidado renderiza os dados **do snapshot**, nunca refaz a
  consulta — provando que o que foi entregue não muda.

Cada saída vira um `ReportExport` (formato `CSV` | `PRINT` | `PDF` | `DRIVE`,
destino e data) e gera `AuditLog` (`report.snapshot_created`, `report.exported`).
Quem gerou enxerga o próprio snapshot; quem tem acesso à filial enxerga o da
filial; a rede enxerga tudo.

### 11.2 Formatos

- **CSV**: rota `/api/relatorios/[relatorio]/csv` (mesma query, escopo do
  usuário, BOM/`;` para Excel pt-BR) e `/api/relatorios/consolidados/[id]/csv`
  para baixar o snapshot congelado.
- **PDF**: pela impressão do navegador na tela do consolidado (*Imprimir / Salvar
  PDF*). Sem geração de PDF no servidor.
- **Google Drive**: o usuário já está logado no Workspace; o navegador pede, na
  hora, um token com o escopo mínimo `drive.file` (Google Identity Services) e
  envia o CSV. **Nenhum token fica no servidor** — o servidor só registra a
  exportação. Requer `NEXT_PUBLIC_GOOGLE_CLIENT_ID` e, no Google Cloud Console,
  a Drive API habilitada e o escopo `drive.file` na tela de consentimento; sem
  isso o botão fica desabilitado.
