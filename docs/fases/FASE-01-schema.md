# FASE 01 — Modelo de dados e seed

> Schema Prisma completo de todo o sistema, com migrations aplicadas e seed idempotente.

## Contexto

O schema é a decisão mais cara de revisar depois. Faça **todo** o modelo agora, mesmo das
fases futuras (estoque, transferências, solicitações, inventário, notificações), para
não encadear migrations destrutivas no meio do projeto. As telas vêm depois.

## Pré-requisitos

- FASE 00 concluída.
- `docs/ARQUITETURA.md` §2 a §7 lidos.

## Convenções de modelagem

- Todas as tabelas em `snake_case` plural: `branches`, `stock_documents`, `request_lines`.
- PK `id` = `String @id @default(cuid())`.
- Toda entidade de negócio tem `branchId` (exceto as de rede) e `createdAt`/`updatedAt`.
  Entidades que originam documentos também têm `createdById`.
- Relations sempre nomeadas quando houver mais de uma relação para o mesmo model.
- Índices compostos em toda query de listagem por filial + filtro.
- `@@unique` em toda chave natural: `Branch.code`, `Branch.cnpj`, `Item.code`,
  `Item.barcode`, `StorageLocation(branchId, code)`, `User.email`, `EmailPolicy.domain`,
  `Role.slug`, `StockLevel(itemId, storageLocationId)`.
- `onDelete` explícito em toda relation. Regra: `Restrict` para histórico
  (`StockDocument`, `Request`, `AuditLog`); `Cascade` para dependentes frágeis
  (`RequestLine` quando a request é removida em rascunho; `RolePermission`).
- Enums em `SCREAMING_SNAKE`, em inglês.
- `Decimal @db.Decimal(18, 4)` para quantidade; `@db.Decimal(14, 2)` para dinheiro.
- Índices em `createdAt` das tabelas de listagem (ordinação padrão é "mais recente").
- Soft delete apenas onde fizer sentido (`User`, `Item`, `Category`, `Branch`) via `active`.

## Tarefas

### 01.1 — Enums

Definir todos:

```
BranchType:        MATRIX | BRANCH
RoleScope:         ALL_BRANCHES | OWN_BRANCHES
UserStatus:        PENDING | ACTIVE | SUSPENDED | INACTIVE
StockDocumentType: INBOUND | ISSUE | ADJUSTMENT | TRANSFER_OUT | TRANSFER_IN | RETURN | INVENTORY
StockDocumentStatus: DRAFT | POSTED | CANCELLED
TransferStatus:    DRAFT | SENT | IN_TRANSIT | RECEIVED | RETURNED | CANCELLED
RequestStatus:     DRAFT | SUBMITTED | IN_REVIEW | APPROVED | PARTIALLY_APPROVED
                   | REJECTED | IN_PREPARATION | DELIVERED | CANCELLED
RequestPriority:   LOW | NORMAL | HIGH | URGENT
ReservationStatus: ACTIVE | RELEASED | CONSUMED
InventoryStatus:   OPEN | COUNTING | CLOSED | ADJUSTED | CANCELLED
NotificationType:  REQUEST_CREATED | REQUEST_CLAIMED | REQUEST_APPROVED
                   | REQUEST_PARTIALLY_APPROVED | REQUEST_REJECTED | REQUEST_DELIVERED
                   | TRANSFER_SENT | TRANSFER_RECEIVED | STOCK_BELOW_MIN
                   | INVENTORY_DIVERGENCE | ACCESS_REQUESTED | ACCESS_GRANTED
```

### 01.2 — Rede e filiais

- [ ] `Company` — `legalName`, `tradeName`, `cnpj`, `active`.
- [ ] `Branch` — todos os campos de `ARQUITETURA.md` §2, incluindo responsáveis
      (`legalResponsibleId`, `warehouseResponsibleId`, `notificationResponsibleId`,
      `defaultApproverId` como relations para `User`).
- [ ] `StorageLocation` — `branchId`, `code`, `name`, `type`
      (`MAIN_WAREHOUSE | SECONDARY | QUARANTINE | TOOLS | OTHER`), `responsibleId`, `active`.

### 01.3 — Identidade e acesso

- [ ] `User` — `email` (único, normalizado minúsculo), `name`, `avatarUrl`, `status`,
      `lastLoginAt`, `approvedById`, `approvedAt`, `active`.
- [ ] `Membership` — `userId`, `branchId`, `roleId`, `active`, `isDefault`.
      `@@unique([userId, branchId, roleId])`.
- [ ] `Role` — `slug` (único), `name`, `description`, `scope`, `isSystem` (papéis padrão
      não podem ser deletados, podem ser editados), `active`.
- [ ] `RolePermission` — `roleId`, `permissionId`.
- [ ] `Permission` — `id` (chave `recurso:acao` como PK), `resource`, `action`, `group`.
      Seeder com o catálogo completo de `ARQUITETURA.md` §3.3.
- [ ] `EmailPolicy` — `domain`, `pattern`, `autoApprove`, `defaultRoleId`, `defaultBranchId`, `active`.
- [ ] `Invite` — `email`, `token`, `roleId`, `branchId`, `status`
      (`PENDING | ACCEPTED | REVOKED | EXPIRED`), `invitedById`, `expiresAt`.
- [ ] `AuditLog` — `actorId`, `action`, `entityType`, `entityId`, `branchId`, `before` (Json),
      `after` (Json), `ip`, `userAgent`, `createdAt`. **Append-only.**

### 01.4 — Catálogo

- [ ] `Category` — `code`, `name`, `parentId` (auto-relação), `requiresApproval`,
      `description`, `active`.
- [ ] `Unit` — `code` (UN, KG, L, CX, M), `name`, `allowsDecimals`, `active`.
- [ ] `Item` — `code` (SKU), `barcode` (EAN/código interno, único quando presente),
      `name`, `description`, `categoryId`, `unitId`, `referencePrice` (Decimal 14,2),
      `controlledByLot`, `perishable`, `requiresApproval`, `hasSerialControl`,
      `active`, `createdById`.
- [ ] `ItemLot` — `itemId`, `code`, `expirationDate`, `initialQuantity`, `active`.
- [ ] `ItemStockPolicy` — `itemId`, `branchId`, `minimumQuantity`, `maximumQuantity`,
      `alertQuantity`, `averageConsumption`. `@@unique([itemId, branchId])`.

### 01.5 — Estoque

- [ ] `StockLevel` — `itemId`, `storageLocationId`, `branchId`, `quantity`,
      `reservedQuantity`, `averageCost`, `version` (Int, lock otimista), `lastMovementAt`.
      `@@unique([itemId, storageLocationId])`, `@@index([branchId, itemId])`.
- [ ] `StockDocument` — `number` (`@@unique([branchId, number])`), `type`, `status`, `branchId`,
      `storageLocationId`, `destinationLocationId` (para TRANSFER_IN), `date`, `notes`,
      `referenceType`, `referenceId`, `totalQuantity`, `totalCost`, `postedAt`,
      `cancelledByDocumentId` (auto-relação), `createdById`.
- [ ] `StockLine` — `stockDocumentId`, `itemId`, `itemLotId`, `quantity` (sinal: + entrada,
      − saída), `unitCost`, `lineTotal`. **Sem `updatedAt`** — é append-only.
- [ ] `StockReservation` — `requestLineId` (único quando `ACTIVE`), `stockLevelId`,
      `quantity`, `status`, `createdById`.
- [ ] `Transfer` — `number` (`@@unique([branchId, number])`), `originBranchId`,
      `destinationBranchId`, `status`, `priority`, `requestedById`, `sentById`, `sentAt`,
      `receivedById`, `receivedAt`, `notes`, `rejectionReason`.
- [ ] `TransferLine` — `transferId`, `itemId`, `quantitySent`, `quantityReceived`, `notes`.
- [ ] `InventorySession` — `number` (`@@unique([branchId, number])`), `branchId`,
      `status`, `startedAt`, `closedAt`, `closedById`, `notes`, `createdById`.
- [ ] `InventoryLine` — `inventorySessionId`, `itemId`, `storageLocationId`,
      `systemQuantity`, `countedQuantity`, `difference`, `adjusted` (bool), `notes`.

### 01.6 — Solicitações

- [ ] `Request` — `number` (`@@unique([branchId, number])`), `branchId`, `requesterId`,
      `status`, `priority`, `neededAt`, `notes`, `rejectionReason`, `responsibleId`,
      `claimedById`, `claimedAt`, `decidedById`, `decidedAt`, `deliveredAt`, `updatedAt`.
- [ ] `RequestLine` — `requestId`, `itemId`, `requestedQuantity`, `approvedQuantity`,
      `deliveredQuantity`, `unitPriceSnapshot`, `lineNotes`, `nonApprovalReason`,
      `availabilityStatus` (`AVAILABLE | PARTIAL | UNAVAILABLE`).
- [ ] `RequestEvent` — `requestId`, `actorId`, `type`, `fromStatus`, `toStatus`,
      `comment`, `metadata` (Json), `createdAt`. Append-only.
- [ ] `Delivery` — `requestId` (único), `branchId`, `deliveredById`, `deliveredAt`,
      `receivedByName`, `receivedByDocument`, `signatureUrl` (opcional),
      `stockDocumentId`, `notes`.

### 01.7 — Notificações e configuração

- [ ] `Notification` — `userId`, `type`, `title`, `body`, `actorId`, `entityType`,
      `entityId`, `branchId`, `link`, `readAt`, `createdAt`.
      `@@index([userId, readAt, createdAt])`.
- [ ] `Config` — `key` (único), `value` (Json), `description`, `updatedById`.
      Seed com `sla.approvalHours`, `stock.belowMinDedupDays`, `app.name`.

### 01.8 — Migrations e seed

- [ ] Gerar migration e aplicar. Revisar o SQL gerado antes de commitar.
- [ ] `prisma/seed.ts` **idempotente** (usar `upsert` em tudo, nunca `create`):
  - [ ] `Company` matriz.
  - [ ] Filial MATRIZ + 2 filiais de exemplo em cidades diferentes.
  - [ ] `StorageLocation` "Almoxarifado Central" em cada filial.
  - [ ] Catálogo: 4 categorias (com hierarquia), 6 unidades de medida, ~15 itens reais
        (EPI, material de limpeza, escritório, EPIs com lote).
  - [ ] `ItemStockPolicy` com mínimos em ~6 itens.
  - [ ] Catálogo completo de `Permission` + 7 `Role` padrão com as permissões de
        `ARQUITETURA.md` §3.2.
  - [ ] `EmailPolicy` do domínio corporativo de exemplo.
  - [ ] Usuário admin de exemplo (`ADMIN_MATRIZ`) lendo a chave `SEED_ADMIN_EMAIL` do `.env`,
        com status `ACTIVE` e membership na matriz.
  - [ ] `Config` inicial.
  - [ ] **Nenhum** saldo/movimentação de estoque no seed — isso é da FASE 06.
- [ ] Script `pnpm db:reset` = `prisma migrate reset` + `db:seed`.

## Arquivos criados

```
prisma/schema.prisma
prisma/migrations/0_init/
prisma/seed.ts
src/lib/permissions/catalog.ts     # lista de permissões (fonte única, usada pelo seed)
src/lib/roles/seed-permissions.ts  # matriz papel × permissão
```

## Critérios de aceite

- [ ] `pnpm prisma migrate diff` limpo (schema e banco sincronizados).
- [ ] `pnpm prisma validate` e `pnpm prisma format` passam.
- [ ] `pnpm db:reset` roda duas vezes seguidas sem duplicar nada.
- [ ] Toda entidade de negócio tem `branchId` e índice apropriado.
- [ ] `StockLine`, `RequestEvent`, `AuditLog`, `Notification` **não** têm `updatedAt`.
- [ ] Existe `@@unique` para toda chave natural listada acima.
- [ ] A matriz papel × permissão do seed bate exatamente com `ARQUITETURA.md` §3.2 e §3.3.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passam.

## Fora do escopo

CRUD de qualquer entidade, telas, seed de movimentações de estoque.
