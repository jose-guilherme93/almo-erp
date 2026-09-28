# FASE 12 — Relatórios

> Relatórios de consumo, cobertura de estoque, valor por filial e histórico de solicitações.

## Contexto

O dashboard responde "como está agora". O relatório responde "como chegamos até aqui" e
serve para decisão de compras, ajuste de mínimos e prestação de contas para a matriz.

## Pré-requisitos

- FASE 10 concluída (camada de agregação de dashboard já existente e testada).
- FASE 11 concluída (inventário alimenta os relatórios de divergência).

## Tarefas

### 12.1 — Relatórios

`src/app/(app)/relatorios/`:

- [ ] Layout com navegação lateral de relatórios e período/filters na URL.
- [ ] **Consumo por material** — período, filial, categoria: quantidade saída, valor,
      média mensal, ranking. Gráfico + tabela + CSV.
- [ ] **Consumo por solicitante** — quem consumiu mais e com quais materiais.
      Atenção ao dado pessoal: exibir nome e setor, sem judgment na interface.
- [ ] **Valor de estoque por filial e categoria** — posição atual em BRL.
- [ ] **Cobertura e sugestão de reposição** — para cada item abaixo do mínimo:
      consumo médio dos últimos 90 dias, cobertura estimada em dias, quantidade sugerida.
      Usa `ItemStockPolicy`.
- [ ] **Histórico de solicitações** — por período, filial, status e solicitante:
      tempo médio de aprovação, taxa de aprovação parcial, taxa de rejeição.
- [ ] **Movimentações** — extrato por item/local/período, com totalizadores.
      Para auditoria: exporta CSV com identificador de documento.
- [ ] **Divergências de inventário** — itens com contagem diferente do sistema,
      histórico por filial.
- [ ] Relatório de **itens sem movimento** (estoque encravado) e **itens sem política
      de mínimo** (lacuna de configuração) — dois relatórios que sempre revelam problemas.

### 12.2 — Motor de relatórios

`src/server/services/reports/`:

- [ ] Um arquivo por relatório, com função pura de **parâmetros** validada por Zod
      (`from`, `to`, `branchIds`, `categoryId`, `itemId`).
- [ ] Período obrigatório, com presets ("últimos 30 dias", "mês atual", "mês anterior",
      "ano atual").
- [ ] Exportação CSV reutilizando os **mesmos** filtros da tela (mesma query, outro formato).
- [ ] Guard `requirePermission("relatorio:read")` + escopo: `ADMIN_FILIAL` só vê a sua,
      rede vê todas e pode filtrar por filial.
- [ ] Sem N+1; agregações do Prisma; limite de período para evitar consultas absurdas
      (aviso se período > 24 meses).

### 12.3 — Exportação

- [ ] `src/lib/csv.ts` — `toCsv(rows, headers)` com BOM UTF-8 (Excel em pt-BR),
      separador `;`, decimal com vírgula, escape correto.
- [ ] Download via Server Action retornando `Blob`/string, ou rota `route.ts` com
      `Content-Disposition`.
- [ ] Todo export respeita o escopo do usuário (exportar nunca vaza mais que a tela).
- [ ] Nome do arquivo com relatório, período e filial.

## Testes obrigatórios

- [ ] `toCsv` escapa aspas, vírgulas e quebras de linha corretamente.
- [ ] CSV sai com BOM e `;` (aberto corretamente no Excel pt-BR).
- [ ] Relatório de consumo bate com a soma direta dos `StockLine` do período.
- [ ] `ADMIN_FILIAL` recebe erro ao pedir relatório de outra filial.
- [ ] Datas inválidas ou período invertido são rejeitados com mensagem clara.
- [ ] Export de um período longo avisa sobre o limite.

## Critérios de aceite

- [ ] Todos os relatórios abrem com filtro de período e respondem rápido (meta: < 2s em
      volume de 12 meses).
- [ ] Export CSV abre corretamente no Excel em pt-BR, com acentuação.
- [ ] Relatório de reposição lista os 10 itens mais críticos com sugestão coerente.
- [ ] Filtros na URL são compartilháveis e recarregam o mesmo resultado.
- [ ] Nenhum relatório expõe filial fora do escopo do usuário.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passam.

## Fora do escopo

BI externo, envio automático de relatórios por e-mail, gráficos customizados pelo usuário.
