import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("mutações de respostas rápidas entram na auditoria sem registrar conteúdo", async () => {
  const [collectionRoute, itemRoute] = await Promise.all([
    readFile("app/api/quick-replies/route.ts", "utf8"),
    readFile("app/api/quick-replies/[id]/route.ts", "utf8"),
  ]);

  assert.match(collectionRoute, /createAuditLog/);
  assert.match(collectionRoute, /"create_quick_reply"/);
  assert.match(itemRoute, /"update_quick_reply"/);
  assert.match(itemRoute, /"delete_quick_reply"/);
  assert.doesNotMatch(collectionRoute, /content: item\.content/);
  assert.doesNotMatch(itemRoute, /content: item\.content/);
});
