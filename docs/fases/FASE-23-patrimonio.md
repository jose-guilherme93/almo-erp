# FASE 23 — Patrimônio: bem rastreável com dono e histórico

> **Status: implementada.** As três decisões foram respondidas pelo dono do produto e
> estão registradas abaixo. Está no ar o núcleo (schema, entrada por série, atribuição,
> devolução, baixa, histórico e telas) e o vínculo do chamado de TI ao bem
> (`MaintenanceRequest.assetId`): abrir o chamado põe o bem em manutenção, encerrar o
> devolve ao estado anterior.

## Contexto

O almoxarifado controla **quantidade** (saldo por material e local). Ele não controla
**identidade**: dois notebooks do mesmo modelo, comprados juntos, são hoje a mesma linha de
`StockLevel`. Isso serve para insumo, não para patrimônio.

A leitura que fechou o escopo veio da operação:

- **Todo item tecnológico é patrimônio.** Computador, monitor, impressora, switch, tablet — o
  equipamento tem número de série, dono e histórico, e é por isso que a T.I. e o almoxarifado
  precisam olhar o **mesmo** bem. Não são dois cadastros; é um só, visto por dois setores.
- **O código de identificação é do sistema.** Ninguém digita número de patrimônio, como ninguém
  digita o código do material (AGENTS.md §3.11): o servidor gera a etiqueta.
- **Todo bem tem dono.** Sem responsável, o dono é o **Almoxarifado** da filial — nunca "sem dono".
- **Todo bem tem histórico.** O que aconteceu com ele (entrou, foi atribuído, foi para a
  assistência, voltou, foi baixado) fica registrado e não se apaga.

## Regras confirmadas

1. **O dono é uma pessoa (usuário).** Sem responsável, o dono exibido é o **Almoxarifado** da
   filial. (Alternativas descartadas: dono ser sempre um setor; dono poder ser pessoa *ou* setor.)
2. **O patrimônio nasce na entrada.** Ao dar entrada em um `Item` com `hasSerialControl`, o
   sistema pede a série de cada unidade e gera a etiqueta, no Almoxarifado. O cadastro manual
   avulso fica fora desta fase.
3. **TI e almoxarifado enxergam o mesmo bem.** A consulta vive no almoxarifado (permissão
   `patrimonio:read`), e o setor de TI a alcança sem um cadastro paralelo.
4. **A posse não é saída de estoque.** *(respondida)* O bem continua sendo **do almoxarifado**
   mesmo quando alguém usa: se a pessoa for desligada, o bem volta. Então atribuir um
   responsável **não gera `ISSUE`** — o bem fica `IN_USE` ("em posse de alguém") e deixa de
   contar como disponível, mas segue no patrimônio da unidade. Uma saída de estoque de verdade
   (`ISSUE`) só se um dia o bem for efetivamente baixado/consumido.
5. **Etiqueta global e legível.** *(respondida)* O número é **global**, sequencial
   (`PAT-000123`), e a tela o mostra com separação para o olho humano (`PAT 000 123` no rótulo;
   a chave continua canônica). Um bem não se confunde com o de outra unidade pelo número.
6. **Número de série implica patrimônio, com exceção manual.** *(respondida)* Todo `Item` com
   `hasSerialControl` gera patrimônio **por padrão**. O almoxarifado pode dizer, manualmente,
   que aquele item **não** é patrimônio (ex.: insumo rastreável por série que não é bem). O
   padrão é ser patrimônio; a exceção é explícita.

## Modelo proposto

```prisma
enum AssetStatus {
  IN_STOCK       // no almoxarifado, disponível
  IN_USE         // em posse de um responsável (ainda é do almoxarifado)
  IN_MAINTENANCE // em conserto (chamado aberto)
  RETIRED        // baixado
}

/// Um bem físico único (número de série), distinto do `Item` (o modelo).
model Asset {
  id                String      @id @default(cuid())
  tag               String      @unique            // PAT-000123, gerado pelo servidor
  itemId            String      @map("item_id")
  serialNumber      String?     @map("serial_number")
  branchId          String      @map("branch_id")
  storageLocationId String?     @map("storage_location_id")
  /// Responsável atual. `null` = Almoxarifado (dono padrão). A posse nunca
  /// transfere a propriedade: o bem continua sendo da unidade.
  custodianUserId   String?     @map("custodian_user_id")
  status            AssetStatus @default(IN_STOCK)
  acquiredAt        DateTime?   @map("acquired_at")
  retiredAt         DateTime?   @map("retired_at")
  notes             String?
  createdById       String?     @map("created_by_id")
  createdAt         DateTime    @default(now()) @map("created_at")
  updatedAt         DateTime    @updatedAt @map("updated_at")
}

/// Histórico de rastreio. Append-only, como o ledger de estoque.
model AssetEvent {
  id              String          @id @default(cuid())
  assetId         String          @map("asset_id")
  type            AssetEventType  // CREATED, ASSIGNED, RETURNED, MAINTENANCE, RETIRED…
  fromStatus      AssetStatus?    @map("from_status")
  toStatus        AssetStatus?    @map("to_status")
  fromCustodianId String?         @map("from_custodian_id")
  toCustodianId   String?         @map("to_custodian_id")
  referenceType   String?         @map("reference_type")  // MAINTENANCE, STOCK_DOCUMENT…
  referenceId     String?         @map("reference_id")
  actorId         String?         @map("actor_id")
  notes           String?
  createdAt       DateTime        @default(now()) @map("created_at")
}
```

`AssetEvent` é append-only (nunca update/delete), com autor e data — é o **histórico de
rastreio** pedido.

Para a regra 6, a exceção mora no item: um campo `Item.trackAsAsset Boolean @default(true)`
(ou o inverso) permite o almoxarifado marcar "este material com série não é patrimônio". O
padrão continua gerando bem.

## Permissões novas

| Permissão | Papéis | O quê |
|---|---|---|
| `patrimonio:read` | ALMOXARIFE, ADMIN_FILIAL, TI, GESTOR, matriz | ver os bens do escopo e o histórico |
| `patrimonio:manage` | ALMOXARIFE, ADMIN_FILIAL, TI | cadastrar, atribuir responsável, devolver, baixar |

A T.I. entra com `manage` por ser quem repara e devolve equipamento; o almoxarifado, por ser o
dono padrão.

## Fluxos

1. **Entrada (FASE 06).** Linha de `Item` com série: o formulário pede N séries; ao `POSTED`,
   cria N `Asset` (`IN_STOCK`, responsável = Almoxarifado) e um `AssetEvent CREATED` cada, na
   mesma transação. **Sem** movimento de estoque adicional além da própria entrada.
2. **Atribuição.** `/patrimonio/[id]` → "Entregar a" escolhe o usuário → `IN_USE` + evento
   `ASSIGNED`. Não há `ISSUE`: o bem sai do "disponível" pelo `status`, não do saldo.
3. **Devolução.** `IN_USE → IN_STOCK` + evento `RETURNED`.
4. **Chamado de TI.** Ao abrir um chamado informando o número de patrimônio, se ele corresponder
   a um bem cadastrado da unidade, `MaintenanceRequest.assetId` é preenchido e o bem vai para
   `IN_MAINTENANCE`; concluir, recusar ou cancelar o chamado devolve o bem ao estado anterior.
   O técnico vê a etiqueta como link para a ficha do bem.
5. **Baixa.** `RETIRED` exige justificativa e gera evento; o bem sai das listas operacionais.
   Só aqui, se um dia a operação pedir, entra um `ISSUE` de verdade.

## Telas

- `/patrimonio` — lista com filtros (responsável, estado, categoria, filial, sem responsável), na URL.
- `/patrimonio/[id]` — ficha: item, série, etiqueta (legível), responsável, local, estado e
  **histórico** completo.
- No menu: grupo **Insumo** (junto de entrada/ajuste/inventário) com `patrimonio:read`.

## Critérios de aceite

- [x] Migration versionada; `Asset` e `AssetEvent` com trigger que recusa `UPDATE`/`DELETE` em
      `asset_events` (mesmo padrão de `report_snapshots`). O `DELETE` por cascade do bem inteiro
      continua permitido — a aplicação nunca apaga bem, e é o que permite limpar dado de teste.
- [x] Etiqueta gerada pelo servidor, nunca digitada; exibida de forma legível (`PAT 000 123`).
- [x] Bem sem responsável exibe **Almoxarifado** e aparece no filtro "sem responsável".
- [x] Atribuir responsável **não** altera `StockLevel`, com teste que prova isso.
- [x] Entrada de material com série cria os bens na transação do documento.
- [x] `Item.trackAsAsset = false` impede a geração do bem, com teste.
- [x] Toda transição de estado passa por `src/server/services/patrimonio/transitions.ts`, gera
      `AssetEvent` e notifica (atribuição e devolução).
- [x] Abrir chamado com a etiqueta de um bem cadastrado põe o bem em `IN_MAINTENANCE`; concluir,
      recusar ou cancelar o devolve ao estado anterior (testado).
- [x] Toda query filtrada por filial (`branchFilter`, §3.2).
- [x] Testes: criação na entrada, atribuição/devolução, transições válidas e inválidas, escopo,
      histórico imutável e não-alteração de saldo (`patrimonio.test.ts`, 21 casos).
- [x] `docs/ARQUITETURA.md` (§5.6) e `AGENTS.md` (navegação) atualizados.

## Fora do escopo desta entrega

- **Transferência de bem entre unidades**: o bem é da filial; mover entre unidades exigirá
  reconciliar o `Asset` com a transferência de estoque.

O **vínculo do chamado ao bem** (`MaintenanceRequest.assetId`) já está implementado: ver o fluxo 4.
