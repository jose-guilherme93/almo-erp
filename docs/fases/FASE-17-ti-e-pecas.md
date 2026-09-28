# FASE 17 — TI como setor prestador, laudo e peças

> A TI recebe chamados e perícias, atesta o que precisa ser comprado, o
> almoxarifado compra e a TI conclui a troca — tudo num só histórico.

## Contexto

Nem sempre o usuário sabe que o problema é de TI. Um cabo HDMI quebrado é
comprado pelo almoxarifado, mas quem atesta se foi mau uso ou defeito de
fabricação é a TI. O encaminhamento de etapa (FASE 14) resolve isso: o
almoxarifado delega a perícia, a TI devolve com laudo e o comando volta.

## Pré-requisitos

- FASE 14 concluída.

## Tarefas

- [x] Chamado com categoria `IT` é roteado para o setor **TI**
      (`getServiceSectorForCategory`); os demais vão para a **Manutenção**.
- [x] "Chamado de TI" na tela `/solicitar` (atalho com categoria pré-selecionada).
- [x] `manutencao:overview` — a TI vê todos os chamados do escopo; sem ela, só o
      que abriu, o atribuído a ela e o encaminhado ao seu setor.
- [x] Laudo/atestado no encerramento da etapa (`Delegation.report`).
- [x] Caixa do setor `/encaminhamentos` e detalhe `/encaminhamentos/[id]` —
      a TI e o almoxarifado veem o que precisa de resposta.
- [x] Histórico completo da demanda reúne os eventos do chamado e as etapas
      encaminhadas.
- [x] Campo `Request.spawnedFromDelegationId` para ligar a peça pedida à etapa
      que a originou.

## Pendências conhecidas

- [ ] Criar a solicitação de peça **a partir** do laudo da TI (ação que preenche
      `spawnedFromDelegationId` e mostra a origem no almoxarifado).
- [ ] Exibir "veio do chamado TI-xxxx / setor TI" na fila e no detalhe da
      solicitação de material originada de um encaminhamento.
- [ ] Ligar a chegada da peça (`WAITING_PARTS → IN_PROGRESS`) ao recebimento da
      solicitação de material.

## Critérios de aceite

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` verdes.
- [x] A TI só vê demanda de outro setor quando há etapa encaminhada a ela.
- [x] Concluir uma etapa exige laudo, e o setor de origem retoma a demanda.
