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
- [ ] FASE 09 — Notificações
- [ ] FASE 10 — Dashboards
- [ ] FASE 11 — Inventário
- [ ] FASE 12 — Relatórios
- [ ] FASE 13 — Hardening

## Dependências entre fases

```
00 ──▶ 01 ──▶ 02 ──▶ 03 ──▶ 04 ──▶ 05 ──▶ 06 ──▶ 07 ──┐
                    │                                  │
                    └───────────────▶ 08 ◀─────────────┘
                                      │
                                      ▼
                                      09 ──▶ 10 ──▶ 11 ──▶ 12 ──▶ 13
```

Observações:

- **08** depende de **06** (reserva e baixa de estoque) e **07** (pedido deitem ausente
  pode virar transferência).
- **09** depende de **08** e **07** porque notifica eventos dos dois fluxos.
- **10** depende de **09** (contadores do dashboard e sino vêm do mesmo cálculo).
- **11** depende de **06**.
