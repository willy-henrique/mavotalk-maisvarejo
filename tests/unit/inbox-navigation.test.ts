import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Inbox preserva a conversa selecionada na URL e suporta teclado", async () => {
  const source = await readFile("frontend/components/InboxConversations.tsx", "utf8");
  assert.match(source, /function?\s*selectConversation|const selectConversation/);
  assert.match(source, /next\.set\('conversation', id\)/);
  assert.match(source, /clearSelectedConversation/);
  assert.match(source, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(source, /fetchQueuedRef/);
  assert.match(source, /fetchVersionRef/);
  assert.match(source, /shouldRefreshAgain/);
});

/**
 * Puxar um chamado tira ele da lista de aguardando, e o atendente ficava olhando
 * para uma lista onde o chamado não estava mais. Puxar passa a levar para
 * Abertas > Atendendo com a conversa aberta.
 */
test("puxar atendimento leva para Abertas > Atendendo com a conversa aberta", async () => {
  const source = await readFile("frontend/components/InboxConversations.tsx", "utf8");

  assert.match(source, /const focusAssignedConversation/);
  assert.match(source, /setTabAbertas\('abertas'\)/);
  assert.match(source, /setStatusFilter\('em_atendimento'\)/);

  // Os dois caminhos de puxar — o botão da lista e o do cabeçalho — usam o mesmo destino.
  const calls = source.match(/focusAssignedConversation\([a-zA-Z]/g) || [];
  assert.equal(calls.length, 2, `esperava as duas chamadas, veio ${calls.length}`);

  // Falha no assign precisa devolver a lista para onde o atendente estava.
  assert.match(source, /setTabAbertas\(previousTab\)/);
  assert.match(source, /setStatusFilter\(previousStatusFilter\)/);
});

/**
 * O Inbox misturava, numa lista só, quem falava com o RH e quem falava com o
 * delivery. A organização por fila e por dono do atendimento é o que separa isso.
 *
 * A regra de recorte mora em frontend/services/inboxGrouping e é testada por
 * comportamento em inbox-grouping.test.ts. Aqui o que se trava é a fiação: que a
 * tela use aquela regra em vez de reinventar o filtro no meio do JSX.
 */
test("Inbox organiza por fila e por dono, usando a regra testada", async () => {
  const source = await readFile("frontend/components/InboxConversations.tsx", "utf8");

  assert.match(source, /from '\.\.\/services\/inboxGrouping'/);
  assert.match(source, /selectByTab\(conversations, tabAbertas, currentUser\.id\)/);
  assert.match(source, /applyInboxFilters\(inTab, \{ statusFilter, queueId: queueFilter \}\)/);
  assert.match(source, /groupByQueue\(filtered\)/);

  // Terceira aba, com o mesmo recorte da regra.
  assert.match(source, /setTabAbertas\('minhas'\)/);

  // Chips e cabeçalhos precisam sair do recorte da aba, não da lista já filtrada:
  // senão clicar em "RH" zeraria o contador das outras filas.
  assert.match(source, /queueChipsFor\(inTab\)/);

  // Trocar de aba limpa os dois filtros; deixar um para trás mostraria lista vazia
  // sem motivo aparente.
  const trocasDeAba = source.match(/setStatusFilter\(null\); setQueueFilter\(null\)/g) || [];
  assert.equal(trocasDeAba.length, 3, `as tres abas precisam limpar os filtros, veio ${trocasDeAba.length}`);

  // Grupos recolhíveis, com a escolha guardada por atendente.
  assert.match(source, /toggleGroup\(group\.queueId\)/);
  assert.match(source, /collapsedGroups\.includes\(group\.queueId\)/);
  assert.match(source, /storeCollapsedGroups\(currentUser\.id/);
});

/**
 * A API devolve no máximo 80 conversas. No teto, um número exato ao lado do nome
 * da fila seria mentira — e é justamente esse número que decide remanejar equipe.
 */
test("contadores do Inbox admitem o teto do servidor em vez de mentir", async () => {
  const source = await readFile("frontend/components/InboxConversations.tsx", "utf8");

  assert.match(source, /const countsCapped = isCountCapped\(conversations\.length\)/);
  // Todo contador visível passa pelo formatador, inclusive o de cada grupo e chip.
  assert.match(source, /formatCount\(countAbertas, countsCapped\)/);
  assert.match(source, /formatCount\(countMinhas, countsCapped\)/);
  assert.match(source, /formatCount\(chip\.total, countsCapped\)/);
  assert.match(source, /formatCount\(group\.conversations\.length, countsCapped\)/);
  // Os contadores de situação são os mais consultados do painel; se algum dia
  // deixarem de passar pelo formatador, voltam a exibir número exato sobre uma
  // carga truncada.
  assert.match(source, /formatCount\(option\.total, countsCapped\)/);
});

/**
 * A primeira versão do agrupamento empilhou três linhas de controle — contador,
 * chips de status e chips de fila — acima da lista. Numa coluna estreita isso
 * empurrava a primeira conversa para fora da tela: o atendente abria a Caixa de
 * entrada e via controles, não atendimentos.
 *
 * Os filtros passaram a caber num menu só. Este teste existe para que ninguém
 * volte a espalhá-los pelo cabeçalho.
 */
test("filtros do Inbox cabem em um menu, não em fileiras de chips", async () => {
  const source = await readFile("frontend/components/InboxConversations.tsx", "utf8");

  const cabecalho = source.slice(
    source.indexOf('<div className="border-b border-slate-200 px-4 py-3'),
    source.indexOf('<div className="flex-1 overflow-y-auto'),
  );
  assert.ok(cabecalho.length > 0, "não localizei o cabeçalho da lista");

  // A coluna não repete mais o título grande da página e concentra suas ações
  // no mesmo plano visual: contexto, busca, abas e filtros.
  assert.match(cabecalho, /Atendimento/);
  assert.match(cabecalho, /Conversas/);
  assert.match(cabecalho, /Buscar conversa/);
  assert.match(cabecalho, /rounded-xl bg-slate-100 p-1/);

  // Menu só para fila. Situação NÃO pode morar aqui: o contador de quem está
  // esperando ser puxado é o que o atendente olha o dia inteiro, e escondê-lo
  // atrás de um clique foi o erro da versão anterior.
  assert.match(cabecalho, /aria-haspopup="menu"/);
  assert.match(cabecalho, /Todas as filas/);

  // Os três estados ficam visíveis, fora do menu.
  assert.match(cabecalho, /statusOptions\.map\(/);
  const menu = cabecalho.slice(cabecalho.indexOf('role="menu"'), cabecalho.indexOf('statusOptions.map('));
  assert.doesNotMatch(menu, /statusOptions/, 'situação não pode voltar para dentro do menu');

  // Escolher fecha: quem atende quer filtrar e seguir, não administrar um painel.
  const fechamentos = cabecalho.match(/setFiltersOpen\(false\)/g) || [];
  assert.ok(fechamentos.length >= 3, `esperava fechar ao clicar fora e nas escolhas de fila, veio ${fechamentos.length}`);

  // O teto do menu é medido, não fixo: ele nasce por volta de 470px do topo, e um
  // valor grande o bastante para caber dez filas passaria do rodapé em janela
  // baixa, deixando as últimas filas inalcançáveis.
  assert.match(cabecalho, /style=\{\{ maxHeight: filtersMaxHeight \}\}/);
  assert.match(cabecalho, /overflow-y-auto/);

  // A fila ativa aparece no próprio botão, com um "×" que limpa sem reabrir o
  // menu. Filtro escondido vira lista vazia sem explicação.
  assert.match(cabecalho, /selectedQueueChip/);
  assert.match(cabecalho, /Mostrar todas as filas/);
});
