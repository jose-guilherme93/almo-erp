# almo-erp

Mini ERP de almoxarifado: **estoque**, **solicitação de materiais** e **entrega de materiais**,
organizados em uma **matriz** e **unidades (filiais)** espalhadas por bairros e cidades.

> **Status: projeto documentado, nada implementado ainda.**
> Toda a especificação está em [`AGENTS.md`](./AGENTS.md) e [`docs/`](./docs).

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [`AGENTS.md`](./AGENTS.md) | **Comece aqui.** Convenções obrigatórias, regras de ouro, stack, Definition of Done e anti-patterns. É o contrato de trabalho para agentes de IA e humanos. |
| [`docs/ARQUITETURA.md`](./docs/ARQUITETURA.md) | Domínio, cadastro de filial, RBAC, autenticação, estoque, transferências, solicitações, notificações, dashboards e mapa de rotas. |
| [`docs/fases/README.md`](./docs/fases/README.md) | Ordem de execução das 14 fases, dependências e progresso. |

## As 14 fases

| # | Fase | Entrega |
|---|---|---|
| 00 | [Fundamentos](docs/fases/FASE-00-fundamentos.md) | projeto, Docker/Postgres, Prisma, lint, testes, CI |
| 01 | [Schema](docs/fases/FASE-01-schema.md) | Prisma completo + migrations + seed |
| 02 | [Autenticação](docs/fases/FASE-02-autenticacao.md) | Google OAuth restrito a e-mail corporativo aprovado |
| 03 | [RBAC](docs/fases/FASE-03-rbac-usuarios.md) | papéis, permissões, escopo por filial, usuários e papéis editáveis |
| 04 | [Filiais](docs/fases/FASE-04-filiais.md) | cadastro completo de matriz/unidades + locais de almoxarifado |
| 05 | [Catálogo](docs/fases/FASE-05-catalogo.md) | categorias, unidades de medida, materiais, código de barras |
| 06 | [Estoque](docs/fases/FASE-06-estoque.md) | ledger transacional, saldos, entradas, saídas, ajustes, reservas |
| 07 | [Transferências](docs/fases/FASE-07-transferencias.md) | matriz ↔ filiais, recebimento parcial, devolução |
| 08 | [Solicitações](docs/fases/FASE-08-solicitacoes.md) | pedir → aprovar → preparar → entregar, com comprovante |
| 09 | [Notificações](docs/fases/FASE-09-notificacoes.md) | alerta no dashboard de quem responde + caixa de entrada |
| 10 | [Dashboards](docs/fases/FASE-10-dashboards.md) | dashboard da matriz, dashboard da unidade, home do solicitante |
| 11 | [Inventário](docs/fases/FASE-11-inventario.md) | contagem, divergência, ajuste |
| 12 | [Relatórios](docs/fases/FASE-12-relatorios.md) | consumo, reposição, valor de estoque, auditoria |
| 13 | [Hardening](docs/fases/FASE-13-hardening.md) | segurança, performance, e2e, deploy, manual |

## Stack

Next.js 16 (App Router) · TypeScript · Auth.js v5 (Google) · PostgreSQL 17 · Prisma 6 ·
Zod 4 · Tailwind 4 + shadcn/ui · Recharts · Vitest + Playwright.
Detalhes e versões fixadas em [`AGENTS.md` §2](./AGENTS.md).

## As três telas principais

- **`/dashboard`** — só admin da matriz: consolidado de todas as unidades.
- **`/dashboard/unidade/[id]`** — só admin da unidade: fila de chamados, entregas pendentes,
  transferências a receber, itens abaixo do mínimo, e o alerta de novas solicitações.
- **`/solicitacoes/nova`** — qualquer usuário logado pede material;
  **`/meu`** acompanha o próprio pedido.

## Requisitos locais

- Node 22 LTS (ainda não instalado nesta máquina)
- pnpm
- Docker (apenas para o Postgres local)

## Como executar depois

1. Ler `AGENTS.md` integralmente.
2. Abrir `docs/fases/README.md` e começar pela **FASE 00**.
3. Uma fase por branch, respeitando a ordem. Detalhes, tarefas, testes e critérios
   de aceite de cada fase estão no arquivo da fase.
