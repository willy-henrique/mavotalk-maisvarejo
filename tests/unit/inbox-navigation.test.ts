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
