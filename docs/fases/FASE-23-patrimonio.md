# FASE 23 — Patrimônio: bem rastreável com dono e histórico

> **Status: proposta.** O desenho abaixo responde às regras já confirmadas pelo dono do
> produto; as decisões marcadas como **abertas** precisam de resposta antes de codar.
> Enquanto isso, esta fase **não** é implementada (não é uma fase concluída).

## Contexto

O almoxarifado controla **quantidade** (saldo por material e local). Ele não controla
**identidade**: dois notebooks do mesmo modelo, comprados juntos, são hoje a mesma linha de
`StockLevel`. Isso serve para insumo, não para patrimônio.

A leitura que fechou o escopo veio da operação:

- **Todo item tecnológico é patrimônio.** Computador, monitor, impressora, switch, tablet — o
  equipamento tem número de série, dono e histórico, e é por isso que a T.I. e o almoxarifado
  precisam olhar o **mesmo** bem. Não são dois cadastros; é um só, visto por dois setores.
- **O código de identificação é do sistema.** Ninguém digita número de patrimônio, como ninguém
  digita o código do material (AGENTS.md §3.11): o servidor gera `PAT-000123`.
- **Todo bem tem dono.** Sem responsável, o dono é o **Almoxarifado** da filial — nunca "sem dono".
- **Todo bem tem histórico.** O que aconteceu com ele (entrou, foi atribuído, foi para a
  assistência, voltou, foi baixado) fica registrado e não se apaga.

## Regras confirmadas

1. **O dono é uma pessoa (usuário).** Sem responsável, o dono exibido é o **Almoxarifado** da
   filial. (Alternativas descartadas: dono ser sempre um setor; dono poder ser pessoa *ou* setor.)
2. **O patrimônio nasce na entrada.** Ao dar entrada em um `Item` com `hasSerialControl`, o
   sistema pede a série de cada unidade e gera a etiqueta `PAT`, no Almoxarifado. O cadastro
   manual avulso fica fora desta fase.
3. **TI e almoxarifado enxergam o mesmo bem.** A consulta vive no almoxarifado (permissão
   `patrimonio:read`), e o setor de TI a alcança sem um cadastro paralelo.
4. **A unidade é de quem pede / a responsabilidade é de quem recebe** continua valendo
   (AGENTS.md §3.7): quem cria o bem no recebimento é a filial que recebeu, não a que pediu.

## Decisões abertas (responder antes de implementar)

- **A. O bem sai do saldo do estoque?** Duas leituras coerentes:
  - *Integrado* (recomendado): atribuir o bem a uma pessoa gera um `ISSUE` (o equipamento saiu
    fisicamente do almoxarifado), e a devolução gera um `RETURN`. O `StockLevel` continua sendo a
    verdade física e o `Asset` é a camada de identidade/custódia. Respeita o §3.3.
  - *Paralelo*: o bem é um registro de imobilizado e o saldo não muda; o equipamento em uso
    continua contando no estoque da filial. Mais simples de escrever, mas o "disponível" fica
    otimista.
- **B. Alcance da etiqueta `PAT`.** Global (`PAT-000123`) ou por filial (`PAT-JP-0001`)?
  Global é mais simples e único; por filial evita dois bens com o mesmo número em unidades
  diferentes, ao custo de um prefixo a mais.
- **C. O que a série sem patrimônio significa?** Um `Item` com `hasSerialControl` sempre vira
  patrimônio, ou o controle por série pode existir para um insumo rastreável que não é bem
  (ex.: uma bobina com número de lote/série)? Se puder haver os dois, entra um campo
  `isAsset`/categoria `IT`; se não, série e patrimônio são a mesma coisa.

## Modelo proposto

```prisma
enum AssetStatus {
  IN_STOCK       // no almoxarifado
  IN_USE         // com um responsável
  IN_MAINTENANCE // em conserto (chamado aberto)
  RETIRED        // baixado
}

model Asset {
  id                String      @id @default(cuid())
  tag               String      @unique            // PAT-000123, gerado pelo servidor
  itemId            String      @map("item_id")
  serialNumber      String?     @map("serial_number")
  branchId          String      @map("branch_id")
  storageLocationId String?     @map("storage_location_id")
  custodianUserId   String?     @map("custodian_user_id")  // null = Almoxarifado
  status            AssetStatus @default(IN_STOCK)
  acquiredAt        DateTime?   @map("acquired_at")
  retiredAt         DateTime?   @map("retired_at")
  notes             String?
  createdById       String?     @map("created_by_id")
  createdAt         DateTime    @default(now()) @map("created_at")
  updatedAt         DateTime    @updatedAt @map("updated_at")
}

model AssetEvent {          // append-only, como o ledger de estoque
  id             String   @id @default(cuid())
  assetId        String   @map("asset_id")
  type           AssetEventType   // CREATED, ASSIGNED, RETURNED, MAINTENANCE, RETIRED…
  fromStatus     AssetStatus? @map("from_status")
  toStatus       AssetStatus? @map("to_status")
  fromCustodianId String? @map("from_custodian_id")
  toCustodianId   String? @map("to_custodian_id")
  referenceType  String?  @map("reference_type")  // MAINTENANCE, STOCK_DOCUMENT…
  referenceId    String?  @map("reference_id")
  actorId        String?  @map("actor_id")
  notes          String?
  createdAt      DateTime @default(now()) @map("created_at")
}
```

`AssetEvent` é append-only (nunca update/delete), com autor e data — é o **histórico de
rastreio** pedido.

## Permissões novas

| Permissão | Papéis | O quê |
|---|---|---|
| `patrimonio:read` | ALMOXARIFE, ADMIN_FILIAL, TI, GESTOR, matriz | ver os bens do escopo e o histórico |
| `patrimonio:manage` | ALMOXARIFE, ADMIN_FILIAL, TI | cadastrar, atribuir dono, devolver, baixar |

A T.I. entra com `manage` por ser quem repara e devolve equipamento; o almoxarifado, por ser o
dono padrão.

## Fluxos

1. **Entrada (FASE 06).** Linha de `Item` com série: o formulário pede N séries; ao `POSTED`, cria
   N `Asset` (`IN_STOCK`, dono = Almoxarifado) e um `AssetEvent CREATED` cada, na mesma transação.
2. **Atribuição.** `/patrimonio/[id]` → "Entregar a" escolhe o usuário → `IN_USE` + evento
   `ASSIGNED`; na leitura integrada (decisão A), gera o `ISSUE` do saldo.
3. **Devolução.** `IN_USE → IN_STOCK` + evento `RETURNED` (+ `RETURN` no saldo).
4. **Chamado de TI.** `MaintenanceRequest.assetId?` liga o chamado ao bem; abrir muda para
   `IN_MAINTENANCE`, concluir volta ao estado anterior. O técnico vê a ficha e a série sem digitar
   nada.
5. **Baixa.** `RETIRED` exige justificativa e gera evento; o bem sai das listas operacionais.

## Telas

- `/patrimonio` — lista com filtros (dono, estado, categoria, filial, sem dono), na URL.
- `/patrimonio/[id]` — ficha: item, série, etiqueta, dono, local, estado e **histórico** completo.
- No menu: grupo **Insumo** (junto de entrada/ajuste/inventário) com `patrimonio:read`.

## Critérios de aceite (ao implementar)

- [ ] Migration versionada; `Asset` e `AssetEvent` com trigger que recusa `UPDATE`/`DELETE` em
      `asset_events` (mesmo padrão de `report_snapshots`).
- [ ] Etiqueta `PAT` gerada pelo servidor, nunca digitada; campo somente-leitura na tela.
- [ ] Bem sem responsável exibe **Almoxarifado** e aparece no filtro "sem dono".
- [ ] Entrada de material com série cria os bens na transação do documento.
- [ ] Toda transição de estado passa por `src/server/services/patrimonio/transitions.ts`, gera
      `AssetEvent` e (quando de negócio) notificação (§3.6).
- [ ] Toda query filtrada por filial (`scopeBranch`, §3.2).
- [ ] Testes: criação na entrada, atribuição/devolução, transições válidas e inválidas, negação
      fora do escopo, histórico imutável.
- [ ] `docs/ARQUITETURA.md` (nova §Patrimônio) e `AGENTS.md` (permissões e navegação) atualizados.
