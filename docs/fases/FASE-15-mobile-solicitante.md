# FASE 15 — Experiência mobile do solicitante

> Menos tela, menos campo, menos texto. Quem só pede material olha pelo celular.

## Contexto

O solicitante não se preocupa com estoque, aprovação parcial ou relatórios — só
com "meu pedido foi aprovado ou não". A interface precisava refletir isso e
oferecer os três canais de demanda de forma direta.

## Pré-requisitos

- FASE 14 concluída (setor e visibilidade).

## Tarefas

### 15.1 — Três canais de demanda

- [x] `/solicitar`: três botões grandes — **Pedir material**, **Pedir reparo**,
      **Chamado de TI** — sem descrição longa.
- [x] "Chamado de TI" é o mesmo fluxo de chamado com a categoria `IT`
      pré-selecionada (`/reparos/novo?categoria=IT`), que roteia para a TI.
- [x] Cards do mobile sem texto redundante: o título já diz para que serve.

### 15.2 — Campos padrão preenchidos

- [x] Data da solicitação é o momento da abertura (`createdAt`), sem campo.
- [x] Nome de quem solicita é o usuário da sessão, sem campo.
- [x] Unidade pré-selecionada pela filial ativa.
- [x] Setor pré-selecionado pelo vínculo do usuário.
- [x] Formulário de material sem o campo "precisa para" (menos um passo).

### 15.3 — Home enxuta

- [x] `/meu` sem a seção de acessos administrativos.
- [x] Lista de pedidos e chamados com situação legível (aprovado, não aprovado,
      em análise, entregue).
- [x] Atalho único "Fazer um pedido" para a tela de escolha.

## Critérios de aceite

- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` verdes.
- [x] `/solicitar` funciona em 390px com os três canais visíveis sem rolagem.
- [x] Abrir um pedido de material exige apenas: unidade (se necessário), itens e
      envio.
