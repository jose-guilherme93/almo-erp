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
- Ao desativar uma filial (`active = false`), ela **não** aceita novas solicitações nem
  movimentações, mas continua legível para auditoria.
- Filiais com转移 pendente são bloqueadas para desativação.
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
| `ALMOXARIFE` | filial | entradas, saídas, ajustes, cria/envia transferências, recebe, entrega, inventário |
| `SOLICITANTE` | filial | cria e acompanha solicitações próprias |
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
solicitacao:read       solicitacao:create    solicitacao:approve  solicitacao:entregar
inventario:read        inventario:manage
relatorio:read
usuario:read           usuario:manage
papel:read             papel:manage
politica-email:read    politica-email:manage
notificacao:read
configuracao:manage
```

Papéis são **dados**, editáveis na tela de administração. Adicionar papel novo não exige deploy.

### 3.4 Escopo

- `SUPER_ADMIN` e `ADMIN_MATRIZ` têm `scope = ALL_BRANCHES`.
- Os demais têm `scope = OWN_BRANCHES` e só acessam `branchId ∈ ctx.branchIds`.
- Toda verificação passa por `requireBranch(branchId)`, que compara com `ctx.branchIds`.
- Ações destrutivas exigem permissão de `manage` **e** re-autenticação só na Fase 13 (opcional).

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

---

## 5. Estoque

### 5.1 Documento de movimentação

`StockDocument` (cabeçalho) + `StockLine` (linhas). Tipos:

| Tipo | Efeito no saldo | Quem cria |
|---|---|---|
| `INBOUND` (entrada) | + | ALMOXARIFE, ADMIN_FILIAL |
| `ISSUE` (saída por entrega) | − | automático ao concluir entrega |
| `ADJUSTMENT` (ajuste) | ± | ALMOXARIFE, ADMIN_FILIAL — exige justificativa |
| `TRANSFER_OUT` | − na origem | automático ao enviar transferência |
| `TRANSFER_IN` | + no destino | automático ao receber transferência |
| `RETURN` (devolução) | + | GESTOR, ADMIN_FILIAL |
| `INVENTORY` (contagem) | ± | automático ao fechar inventário |

Campos do cabeçalho: `number` (sequencial por filial, ex. `MV-2026-000123`), `type`, `branchId`,
`storageLocationId`, `date`, `notes`, `referenceType`, `referenceId`, `status`
(`DRAFT` | `POSTED` | `CANCELLED`), `postedAt`, `createdById`.

Regra: documento `POSTED` é **imutável**. `CANCELLED` gera documento inverso, nunca delete.

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

`StockReservation` liga `requestLineId` a `stockLevelId` com `quantity` e `status`
(`ACTIVE` | `RELEASED` | `CONSUMED`). Criada na **aprovação**, consumida na **entrega**,
liberada em rejeição/cancelamento. Impede aprovar o que não existe.

### 5.4 Mínimo e alerta

`ItemStockPolicy` (item + filial) define `minimumQuantity`, `maximumQuantity`, `alertQuantity`.
Ao `POSTED` um documento, verifica-se o mínimo e dispara `STOCK_BELOW_MIN` (com
**deduplicação**: só notifica se não existe não-lida igual nos últimos 7 dias).

### 5.5 Transferência

`Transfer` + `TransferLine`.

```
DRAFT ──enviar──▶ SENT ──sai da origem──▶ IN_TRANSIT
                        (gera TRANSFER_OUT na origem)
        ◀──rejeitar──┘
IN_TRANSIT ──receber──▶ RECEIVED        (gera TRANSFER_IN no destino)
        ──devolver───▶ RETURNED
dRAFT/SENT/IN_TRANSIT ──cancelar──▶ CANCELLED
```

- `quantityReceived` pode ser menor que `quantitySent` → **recebimento parcial**, com o
  excedente gerando `RETURNED` automático.
- Bloqueia saldo na origem ao `SENT` (reserva de transferência) ou baixa imediata:
  escolha **baixa imediata** em `SENT` e registre o documento; a reserva de estoque da
  solicitação é outro conceito e não se mistura.
- Quem envia: `ALMOXARIFE`/`ADMIN_FILIAL` na origem. Quem recebe: `ALMOXARIFE`/`GESTOR`/`ADMIN_FILIAL`
  no destino. Notificação `TRANSFER_SENT` para todos os receptores do destino.

---

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
| `REQUEST_CREATED` | `defaultApproverId` + todos com `solicitacao:approve` na filial (exceto o autor) |
| `REQUEST_CLAIMED` | demais aprovadores da filial (saiu da fila) |
| `REQUEST_APPROVED` / `PARTIALLY_APPROVED` / `REJECTED` | `requesterId` |
| `REQUEST_DELIVERED` | `requesterId` + `responsibleId` |
| `TRANSFER_SENT` | `ALMOXARIFE`/`GESTOR`/`ADMIN_FILIAL` do destino |
| `TRANSFER_RECEIVED` | `ALMOXARIFE`/`ADMIN_MATRIZ` da origem |
| `STOCK_BELOW_MIN` | `ALMOXARIFE` + `ADMIN_FILIAL` da filial (deduplicado) |
| `INVENTORY_DIVERGENCE` | `ADMIN_FILIAL` + `ADMIN_MATRIZ` |
| `ACCESS_REQUESTED` | todos `SUPER_ADMIN` |
| `ACCESS_GRANTED` | o próprio usuário |

Regras comuns:

- Criadas na **mesma transação** do evento.
- Excluem o `actorId` quando o ator é o alvo natural.
- Sempre com `entityType` + `entityId` + `link` para deep link.
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
| `/reparos` | `manutencao:read` | qualquer logado com vínculo |
| `/reparos/novo` | `manutencao:create` | qualquer logado |
| `/reparos/[id]` | `manutencao:read` | quem abriu, quem atende, gestão da unidade |
| `/solicitacoes` | `solicitacao:read` | qualquer logado (as próprias) |
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
| `/relatorios` | `relatorio:read` | GESTOR+ |
| `/admin/usuarios` | `usuario:manage` | SUPER_ADMIN, ADMIN_FILIAL (escopo) |
| `/admin/papeis` | `papel:manage` | SUPER_ADMIN |
| `/admin/politicas-email` | `politica-email:manage` | SUPER_ADMIN |
| `/admin/configuracoes` | `configuracao:manage` | SUPER_ADMIN |

---

## 9.1 Chamados de reparo

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
