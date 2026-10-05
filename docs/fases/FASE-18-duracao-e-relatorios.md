# FASE 18 — Duração das demandas e observabilidade por setor

> O almoxarifado precisa saber quais setores demandam mais e quanto tempo cada
> demanda leva, para comparar mês a mês e melhorar.

## Contexto

A trilha de eventos já existe desde a FASE 08/09 (e a de encaminhamento veio na
FASE 14). Faltava transformar isso em indicador: demanda por setor e duração do
ciclo, com quebra mensal.

## Pré-requisitos

- FASE 14 concluída.

## Tarefas

- [x] Relatório **Demanda por setor**: pedidos de material e chamados por setor,
      com total, em aberto, concluídas e valor estimado de material.
- [x] Relatório **Duração das demandas**: competência (mês), tipo
      (material/chamado/etapa em outro setor), demandas, concluídas, tempo médio
      e tempo máximo entre abertura e fechamento.
- [x] Tempo da etapa considera o intervalo entre encaminhar e concluir o laudo.
- [x] Ambos disponíveis em tela e em CSV (`/relatorios` e
      `/api/relatorios/[relatorio]/csv`).
- [x] Testes de metadados cobrindo os dois relatórios.

## Pendências conhecidas

- [ ] Gráfico de evolução mês a mês na tela de relatórios (Recharts).
- [ ] Recorte por setor no filtro da tela (hoje o recorte é por unidade/período).

## Critérios de aceite

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` verdes.
- [x] É possível ver quais setores abrem mais demanda e quanto tempo levam.
- [x] A comparação mês a mês sai da coluna de competência.
