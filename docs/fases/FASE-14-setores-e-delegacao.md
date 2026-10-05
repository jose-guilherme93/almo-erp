# FASE 14 — Setores, encaminhamento e visibilidade do solicitante

> O produto vira um portal de demandas: todo usuário é solicitante e cada
> demanda sabe de qual setor veio e qual setor atende.

## Contexto

Antes desta fase, qualquer usuário com vínculo na filial enxergava **todas** as
solicitações daquela filial — o solicitante via pedidos de terceiros. Além
disso, não existia o conceito de setor (Financeiro, Pedagógico, RH, TI), então
o almoxarifado não conseguia saber qual área demanda mais, nem encaminhar uma
etapa para a TI.

## Pré-requisitos

- Fases 00 a 13 concluídas.

## Tarefas

### 14.1 — Modelo de setor

- [x] `Sector` (`code`, `name`, `kind`: `REQUESTER | SERVICE | BOTH`, `active`).
- [x] `Membership.sectorId` — o setor mora no vínculo do usuário e pré-seleciona
      o setor na abertura da solicitação.
- [x] `Request.sectorId` / `Request.serviceSectorId`.
- [x] `MaintenanceRequest.sectorId` / `MaintenanceRequest.serviceSectorId`.
- [x] Seed idempotente: Financeiro, Pedagógico, RH, Almoxarifado, Manutenção, TI.
- [x] Migration `20260928180000_setores_delegacao_anexos`.

### 14.2 — Encaminhamento de etapa entre setores

- [x] `Delegation` + `DelegationEvent` (aponta para `Request` **ou**
      `MaintenanceRequest`): `fromSectorId`, `toSectorId`, `status`, `reason`,
      `report` (laudo), autores e timestamps.
- [x] Máquina de estados explícita (`PENDING → ACCEPTED → IN_PROGRESS →
      COMPLETED → RETURNED`, mais `CANCELLED`).
- [x] Serviço `src/server/services/delegation` — criar, assumir, registrar
      andamento, concluir com laudo, devolver e cancelar.
- [x] Notificações `DELEGATION_REQUESTED/ACCEPTED/COMPLETED/RETURNED`, resolvidas
      por **setor** (não por pessoa), na mesma transação.
- [x] Auditoria (`AuditLog`) em toda transição.

### 14.3 — Visibilidade

- [x] Solicitante sem visão geral enxerga **só** o que pediu ou o que foi
      encaminhado ao seu setor.
- [x] `solicitacao:overview` (almoxarifado) e `manutencao:overview` (setor de
      atendimento) dão a visão do escopo de filiais.
- [x] O setor de serviço só vê a solicitação porque a etapa foi encaminhada a ele.
- [x] Novo papel `TI` (escopo por filial, sem visão geral do almoxarifado).
- [x] `SOLICITANTE` enxugado: sem estoque, transferências e catálogo de gestão.
- [x] Navegação do solicitante mostra apenas **Visão geral** e **Solicitações**.

### 14.4 — Testes

- [x] `delegation.test.ts`: fan-out, visibilidade por setor, transições,
      laudo obrigatório e retomada pela origem.
- [x] `request.test.ts`: solicitante vê só as próprias; visão geral vê a filial.
- [x] `permissions.test.ts`: papel TI e contenção do SOLICITANTE.

## Pendências conhecidas

- [ ] CRUD de setores na administração (hoje os setores vêm do seed).
- [ ] Vínculo do setor do usuário editável na tela de usuário/vínculo.

## Critérios de aceite

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` e `pnpm db:seed` verdes.
- [x] Um solicitante não enxerga demanda de terceiros.
- [x] Um setor só enxerga a demanda enquanto tem etapa nela.
- [x] `docs/ARQUITETURA.md` e `AGENTS.md` atualizados.
