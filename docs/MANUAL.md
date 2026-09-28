# Manual do usuário — almo-erp

Guia por perfil. Cada seção assume que você já entrou no sistema com sua conta
corporativa do Google.

---

## Para quem solicita material

### Pedir material

1. Menu **Minhas solicitações** → botão **Solicitar material** (ou **Solicitar material**
   na tela inicial).
2. Escolha a **prioridade**:
   - **Baixa** — sem urgência, entra na fila normal.
   - **Normal** — prazo habitual da unidade.
   - **Alta** — sobe na fila.
   - **Urgente** — parada de operação, primeiro da fila.
3. Se tiver data em mente, preencha **Precisa para**.
4. Busque o material por **nome**, **código** ou **código de barras** (o botão de
   câmera lê o código; se não houver câmera, use **Digitar código**).
5. Informe a **quantidade**. Ao lado aparece quanto existe disponível na sua unidade
   agora.
   > Pedir algo em falta é permitido: o aprovador pode aprovar parcialmente ou pedir
   > transferência de outra unidade. O aviso é para você saber o que esperar.
6. Explique a necessidade no campo **Justificativa do pedido**, se não for rotineiro.
7. **Criar solicitação**.

A solicitação fica como **rascunho**. Ela só vai para a unidade quando você clicar em
**Enviar para aprovação**.

### Acompanhar

Em **Minhas solicitações** você vê cada pedido e a situação:

| Situação | O que significa |
|---|---|
| Rascunho | Ainda não enviado. Só você vê. |
| Aguardando aprovação | Na fila da sua unidade. |
| Em análise | Um aprovador assumiu o pedido. |
| Aprovada | Liberada. O material está reservado para você. |
| Aprovada parcialmente | Parte foi aprovada. Veja o motivo item por item. |
| Rejeitada | Não foi aprovada. O motivo está registrado. |
| Em separação | O almoxarife está separando o material. |
| Entregue | Retirado. O comprovante está disponível. |

A linha do tempo na página do pedido mostra **quem fez o quê e quando**.

### Cancelar

Enquanto estiver em **Rascunho** ou **Aguardando aprovação**, você pode cancelar.

### Ser avisado

O **sino** no topo mostra quantos avisos não lidos você tem. As notificações chegam
quando seu pedido é aprovado, aprovado parcialmente, rejeitado ou entregue.

---

## Para quem aprova (gestor e administrador da unidade)

Seu ponto de partida é o **dashboard da unidade**: ao entrar no sistema você cai direto
nele.

O primeiro bloco da tela, **Precisa da sua resposta**, é o que está esperando decisão.
Ele ordena por prioridade e tempo de espera, e marca com ⚠ o que passou de 24 horas.

### Decidir um pedido

1. Abra a solicitação (pelo dashboard ou por **Fila de aprovação**).
2. Confira os itens e o que existe disponível.
3. Opcionalmente, clique em **Assumir análise** — isso avisa os outros aprovadores que
   você está cuidando do pedido.
4. Clique em **Decidir**:
   - **Aprovação total**: mantenha as quantidades como estão.
   - **Aprovação parcial**: reduza a quantidade e **explique o motivo** de cada item
     reduzido. O solicitante vê exatamente o que não foi atendido e por quê.
5. Ou clique em **Rejeitar** e escreva o motivo.

Ao aprovar, o sistema **reserva** o material para o pedido: ele sai do disponível e
fica separado, sem ainda baixar do estoque.

> **Se não houver saldo**, a aprovação é recusada e nada muda. Nesse caso:
> aprove parcialmente o que existe, ou peça transferência de outra unidade.

---

## Para o almoxarife

### Receber material (entrada)

**Estoque → Entradas → Nova entrada**.

1. Escolha o **local de estoque** de destino.
2. Informe **fornecedor** e **documento de referência** (nota fiscal, ordem de serviço).
3. Busque cada material (nome, código ou código de barras).
4. Informe **quantidade** e **custo unitário** — o custo alimenta o custo médio.
5. Para material controlado por lote, escolha o **lote** (lotes vencidos não aparecem).
6. **Lançar entrada**.

### Entregar material

**Entregas** lista as solicitações aprovadas.

1. Abra a solicitação e separe o material do local indicado.
2. Confira as quantidades. Se não puder entregar tudo, **ajuste a quantidade** — o que
   sobrar volta automaticamente para o disponível.
3. Preencha **quem recebeu** (e o CPF, se possível).
4. **Confirmar entrega e dar baixa no estoque**.

O comprovante fica disponível para impressão, com espaço para assinatura.

### Transferir material para outra unidade

**Transferências → Nova transferência**.

1. Escolha a **unidade de destino** e a **prioridade**.
2. Adicione os materiais e as quantidades.
3. **Criar transferência** (fica como rascunho).
4. Na página da transferência, **Enviar** — isso baixa o saldo da sua unidade e avisa o
   destino de que o material está a caminho.
5. Quando o material sair fisicamente, confirme o **despacho**.

### Receber uma transferência

Na unidade de destino, o **sino** avisa e a transferência aparece em **Chegando**.

1. Abra a transferência e clique em **Receber material**.
2. Confira item por item. Se veio menos, **ajuste a quantidade**.
3. **Confirmar recebimento**.

O que faltou continua **em trânsito** e pode ser **devolvido** para a origem.

### Ajustar estoque

**Estoque → Ajustes → Novo ajuste**. Use quantidade **negativa** para reduzir (quebra,
perda) e **positiva** para aumentar.

A **justificativa é obrigatória** — é a única explicação de uma mudança de saldo sem
documento de origem, e é o que fica na auditoria.

### Contar o estoque (inventário)

**Inventário → Novo inventário**.

1. Escolha o escopo: local, categoria e/ou "somente sem movimento há N dias".
2. Na tela de contagem:
   - Digite a quantidade de cada item. **Campo vazio significa não contado** — só
     preencha zero se o item realmente não estiver na prateleira.
   - Use **Só não contados** para não se perder.
   - Use **Ocultar sistema** para contar às cegas (evita confirmar o número da tela).
3. **Salvar contagem** periodicamente.
4. **Encerrar contagem** quando terminar. Nada muda no estoque ainda.
5. Revise as **divergências**, escreva a justificativa de cada uma e **Aplicar ajuste**.

---

## Para o administrador da unidade

**Administração → Usuários**. Você gerencia quem tem acesso e com qual perfil.

- **Novo usuário**: informe nome, e-mail corporativo, perfil e unidades.
  Sem marcar "ativar imediatamente", a pessoa entra aguardando aprovação.
- No detalhe do usuário você **adiciona e remove vínculos**, troca o perfil e
  **suspende ou reativa** o acesso.
  > Suspender derruba o acesso na próxima ação da pessoa — não é preciso esperar nada.

**Usuários, materiais, categorias e unidades de medida** têm seus catálogos em
**Cadastros**.

### Definir o mínimo de estoque

Na página do material, aba **Mínimos por unidade**: informe o mínimo e marque as
unidades. Quando o saldo disponível cruzar o mínimo, o almoxarife e você recebem um
alerta (o mesmo alerta não se repete por alguns dias).

---

## Para o administrador da matriz

**Dashboard da matriz** consolida toda a rede:

- valor em estoque, solicitações pendentes, transferências em trânsito, itens abaixo do
  mínimo e tempo médio de aprovação;
- gráficos de entradas e saídas, valor por unidade, top materiais e valor por categoria;
- tabela de **pendências por unidade**, com atalho para o dashboard de cada uma.

**Visão por unidade** compara responsável, itens, valor, pendências e último movimento —
serve para saber onde agir primeiro.

**Cadastro de unidades** em **Cadastros → Unidades**: dados fiscais, endereço,
responsáveis e locais de estoque.

**Administração → Perfis e permissões** permite criar perfis sob medida. Perfis de
sistema não podem ser excluídos, apenas ajustados — e a mudança vale no próximo acesso
dos usuários vinculados.

**Administração → Políticas de e-mail** define quem pode entrar. O formulário testa a
expressão regular contra um e-mail de exemplo antes de salvar.

**Administração → Auditoria** mostra tudo que foi feito: quem, quando, de qual IP e com
quais valores antes e depois.

**Administração → Configurações** ajusta SLA de aprovação, deduplicação de alerta e
limite de valor para aprovação da matriz.

---

## Perguntas frequentes

**Não consigo entrar.** Provavelmente seu e-mail não está cadastrado ou não é do domínio
corporativo. A tela de acesso negado explica o motivo; peça a um administrador.

**Pedi e foi aprovado parcialmente. Por quê?** Não havia saldo suficiente. O motivo está
escrito em cada item não atendido.

**O estoque mudou e não sei por quê.** Abra o material, aba **Estoque**, e em seguida
**Estoque → Movimentações**. Todo lançamento tem documento, responsável e data; ajustes
têm justificativa.

**Errei um lançamento.** Abra a movimentação e use **Cancelar movimentação**. Nada é
apagado: o sistema gera o lançamento inverso e os dois ficam no histórico.

**Posso usar no celular?** Sim. As telas de contagem, entrega e requisição foram feitas
pensando no uso no balcão.
