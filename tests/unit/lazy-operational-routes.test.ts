import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Inbox é carregado sob demanda e não integra o bundle inicial de login", async () => {
  const source = await readFile("frontend/App.tsx", "utf8");

  assert.match(source, /const InboxConversations = React\.lazy\(\(\) => import\('\.\/components\/InboxConversations'\)\)/);
  assert.doesNotMatch(source, /import InboxConversations from/);
});
