# Caixa de entrada — organização por fila e por dono

**Data:** 21/08/2026
**Origem:** pedido do cliente final, relatado pelo Mateus
**Status:** implementado

---

## O problema

A Caixa de entrada listava tudo numa coluna só. Quem atende RH via, misturadas, as
conversas de quem está tocando Delivery. Com a criação de filas por departamento
(RH, Financeiro, Compras), a lista ficaria pior, não melhor.

Palavras do cliente: *"quando a pessoa tá falando comigo, não ficar ali misturado
as conversas com a pessoa que tá falando com alguém que tá fazendo delivery"*.

## Escopo — e o que ficou de fora

**Isto é organização visual.** Todo atendente continua enxergando toda conversa. A
pergunta foi feita explicitamente ao cliente e a resposta foi *"só ficar organizado,
não precisa ser restrito"*.

**Restrição de acesso ficou fora, de propósito.** Se um dia RH precisar ser
invisível para o Delivery, isso exige vínculo usuário↔fila e filtro **no servidor**.
Feito só na tela seria vazamento com aparência de funcionalidade: hoje a busca do
Inbox já encontra por nome de fila, e trocar o filtro é um clique.

## O que já existia

Quase toda a fundação. Nada disso precisou ser construído:

- `queues` com nome livre e cor, com CRUD completo no painel;
- o bot já grava `conversations.queue_id` quando o cliente escolhe a opção;
- "Puxar" já grava `tickets.assignee_id`;
- a API do Inbox já devolve `queue` (com `colorHex` e `menuOption`) e `ticket.assignee`.

O que faltava era só apresentação.

## Desenho

### Três abas

`ABERTAS` · `MINHAS` · `RESOLVIDOS`

`MINHAS` = chamados **em aberto** que o atendente puxou. O que ele resolveu sai dali
e vai para `RESOLVIDOS` junto com o dos outros — senão a aba cresce para sempre e
deixa de responder "o que falta fazer agora".

`ABERTAS` carrega o contador no próprio rótulo. Isso resolve o risco que a aba
separada cria: quem está trabalhando dentro de `MINHAS` precisa perceber que chegou
coisa nova na fila geral sem trocar de aba para descobrir.

### Lista agrupada

Cabeçalho por fila, com bolinha na cor cadastrada e contagem. Ordem:

1. **Sem fila** fixo no topo — é a triagem, gente que escreveu e ficou parada sem
   dono. É o grupo que mais precisa de olho e o que mais facilmente seria esquecido
   no fim da lista. A posição é decisão operacional, não estética.
2. As demais na ordem de `menu_option`, a mesma que o cliente final viu no WhatsApp.
   O operador aprende uma ordem só.

Grupos vazios não são criados: fila cadastrada e sem movimento vira ruído permanente.

Grupos são recolhíveis, abertos por padrão, e a escolha é guardada por atendente em
`localStorage`. Quem cuida de uma fila só recolhe o resto uma vez.

### Um menu de filtros, não fileiras de chips

**A primeira versão errou aqui.** Os filtros de fila entraram como uma fileira de
chips, somada à fileira de status e à linha de contador que já existiam. Em coluna
estreita os chips quebravam em três linhas e empurravam a primeira conversa para
fora da tela: o atendente abria a Caixa de entrada e via controles, não
atendimentos. Abas também estouravam a largura, cortando "RESOLVIDOS".

As três linhas viraram uma: um botão `FILTROS` que abre um menu com as duas
facetas — **Situação** (atendendo / aguardando / em triagem) e **Fila** (todas /
sem fila / cada fila cadastrada), cada item com sua cor e contagem. De ~218px de
controles para ~72px.

Decisões dentro do menu:

- **Escolher fecha o menu.** Quem atende quer filtrar e seguir, não administrar um
  painel de facetas.
- **Altura medida, não fixa.** O menu nasce por volta de 470px do topo; qualquer
  teto em `rem` grande o bastante para dez filas passaria do rodapé em janela
  baixa, deixando as últimas filas inalcançáveis. A altura é calculada na abertura
  a partir do espaço real abaixo do botão, com piso de 180px e rolagem própria.
- **O filtro ativo aparece fora do menu**, como pílula com um "×". Filtro escondido
  vira lista vazia sem explicação, e o atendente conclui que quebrou.
- **Conectado vira só um ponto verde.** O texto do tempo real só aparece quando há
  problema — que é quando o atendente precisa saber.

**Status e fila compõem, não se substituem.** "Em atendimento" **e** "Delivery"
responde *"o que o time de entrega está tocando agora"*, que é a pergunta de quem
coordena. Se um filtro limpasse o outro, essa pergunta ficaria sem resposta.

**As contagens derivam do recorte da aba, não da lista já filtrada.** Filtrar por RH
não pode zerar o contador das outras filas: o operador perderia exatamente a visão
de carga que motivou o agrupamento.

### Contador honesto

`listConversations` devolve no máximo 80 registros. No teto, todo número derivado
pode ser menor que a realidade — e é justamente esse número que decide remanejar
equipe. Batendo em 80, os contadores passam a exibir `12+` em vez de `12`.

Preferiu-se isso a construir contagem no servidor: hoje são 27 conversas abertas,
e construir a solução de escala antes da escala existir é gasto sem retorno.

**Gatilho para revisitar:** quando o volume se aproximar de 80 conversas abertas,
trocar a contagem client-side por um `GROUP BY` no servidor.

## Arquitetura

A regra de recorte vive em `frontend/services/inboxGrouping.ts`, fora do componente,
por dois motivos: pode ser testada sem montar React, e "o que aparece e em que ordem"
é decisão de produto — ela some quando fica diluída no meio de JSX.

| Função | Responsabilidade |
|---|---|
| `selectByTab` | recorte da aba (abertas / minhas / resolvidos) |
| `applyInboxFilters` | composição de status + fila |
| `groupByQueue` | agrupamento ordenado, sem fila no topo |
| `queueChipsFor` | chips, derivados do mesmo agrupamento |
| `isCountCapped` / `formatCount` | contador honesto no teto |

O componente `InboxConversations.tsx` só orquestra e desenha. A busca por texto
continua nele por depender do estado da tela.

## Verificação

- **15 testes de comportamento** em `tests/unit/inbox-grouping.test.ts`, sem React.
- **4 testes de fiação** em `tests/unit/inbox-navigation.test.ts`, garantindo que a
  tela use a regra testada em vez de reinventar o filtro no JSX.
- **Suíte completa:** 279 testes, 277 aprovados, 0 falhas.
- **Typecheck** limpo no backend e no frontend.
- **Conferência na tela real**, com a SPA rodando contra fixtures das cinco filas:
  ordem dos grupos, troca de aba, filtro de fila, composição status+fila,
  preservação das contagens ao filtrar, recolhimento e persistência após recarregar.

## Próximo passo, se o cliente pedir

Restrição de acesso por fila: tabela de vínculo usuário↔fila, filtro no servidor e
teste de isolamento, no mesmo padrão do RLS multiempresa que o produto já usa.
