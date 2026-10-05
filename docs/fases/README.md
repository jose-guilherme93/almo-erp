# Fases de implementação

Ordem obrigatória. **Não implemente uma fase sem ler o arquivo dela aqui.**
Não pule fase e não "adiante" parte de fase futura.

## Índice

| Fase | Título | Entrega principal |
|---|---|---|
| [00](FASE-00-fundamentos.md) | Fundamentos e ambiente | projeto rodando, lint/test/build verdes, Postgres local |
| [01](FASE-01-schema.md) | Modelo de dados e seed | Prisma completo + migrations + seed idempotente |
| [02](FASE-02-autenticacao.md) | Autenticação Google e regra de e-mail | login só com e-mail corporativo aprovado |
| [03](FASE-03-rbac-usuarios.md) | RBAC, usuários, convites e papéis | permissões corretas e escopo por filial |
| [04](FASE-04-filiais.md) | Cadastro de filiais e locais de estoque | cadastro completo de matriz e unidades |
| [05](FASE-05-catalogo.md) | Catálogo de materiais | categorias, unidades de medida, itens, código de barras |
| [06](FASE-06-estoque.md) | Estoque: saldos e movimentações | ledger de estoque transacional |
| [07](FASE-07-transferencias.md) | Transferências entre unidades | ida e volta com recebimento parcial |
| [08](FASE-08-solicitacoes.md) | Solicitações de materiais | fluxo pedido → aprovação → entrega |
| [09](FASE-09-notificacoes.md) | Notificações e caixa de entrada | alerta no dashboard de quem responde |
| [10](FASE-10-dashboards.md) | Dashboards por perfil | 3 telas distintas: matriz, unidade, solicitante |
| [11](FASE-11-inventario.md) | Inventário | contagem e ajuste por divergência |
| [12](FASE-12-relatorios.md) | Relatórios | consumo, cobertura, valor de estoque |
| [13](FASE-13-hardening.md) | Hardening, testes e deploy | auditoria, SLA, e2e, produção |
| [14](FASE-14-setores-e-delegacao.md) | Setores, encaminhamento e visibilidade | todo usuário é solicitante; etapa entre setores |
| [15](FASE-15-mobile-solicitante.md) | Experiência mobile do solicitante | 3 canais, defaults, menos tela |
| [16](FASE-16-anexos-imagem.md) | Anexos de imagem com compressão | foto do problema leve e segura |
| [17](FASE-17-ti-e-pecas.md) | TI como setor prestador | chamado de TI, laudo e peças |
| [18](FASE-18-duracao-e-relatorios.md) | Duração e observabilidade | demanda por setor e tempo por mês |
| [19](FASE-19-simplificacao.md) | Simplificação | entrada pela câmera sem cadastro prév e menu por tarefa |

## Regras de execução das fases

1. Uma branch por fase: `feat/fase-NN-slug`.
2. Comece lendo `AGENTS.md` e `docs/ARQUITETURA.md`.
3. Ao final, rode **na ordem**: `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build` → `pnpm db:seed`.
4. Marque a fase como ✅ na tabela abaixo **e** no checklist do próprio arquivo da fase.
5. Se a fase mudou alguma regra de negócio, atualize `docs/ARQUITETURA.md` no mesmo PR.
6. PR com os critérios de aceite da fase marcados como checklist.

## Progresso

- [x] FASE 00 — Fundamentos
- [x] FASE 01 — Schema
- [x] FASE 02 — Autenticação
- [x] FASE 03 — RBAC
- [x] FASE 04 — Filiais
- [x] FASE 05 — Catálogo
- [x] FASE 06 — Estoque
- [x] FASE 07 — Transferências
- [x] FASE 08 — Solicitações
- [x] FASE 09 — Notificações
- [x] FASE 10 — Dashboards
- [x] FASE 11 — Inventário
- [x] FASE 12 — Relatórios
- [x] FASE 13 — Hardening
- [x] FASE 14 — Setores e delegação
- [x] FASE 15 — Mobile do solicitante
- [x] FASE 16 — Anexos de imagem
- [x] FASE 17 — TI e peças
- [x] FASE 18 — Duração e relatórios
- [x] FASE 19 — Simplificação

## Dependências entre fases

```
00 ──▶ 01 ──▶ 02 ──▶ 03 ──▶ 04 ──▶ 05 ──▶ 06 ──▶ 07 ──┐
                    │                                  │
                    └───────────────▶ 08 ◀─────────────┘
                                      │
                                      ▼
                                      09 ──▶ 10 ──▶ 11 ──▶ 12 ──▶ 13 ──▶ 14
                                                                        │
                                              ┌─────────────┬───────────┼───────────┐
                                              ▼             ▼           ▼           ▼
                                             15            16          17          18
```

Observações:

- **08** depende de **06** (reserva e baixa de estoque) e **07** (pedido deitem ausente
  pode virar transferência).
- **09** depende de **08** e **07** porque notifica eventos dos dois fluxos.
- **10** depende de **09** (contadores do dashboard e sino vêm do mesmo cálculo).
- **11** depende de **06**.
