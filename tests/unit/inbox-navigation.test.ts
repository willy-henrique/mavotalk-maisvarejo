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
