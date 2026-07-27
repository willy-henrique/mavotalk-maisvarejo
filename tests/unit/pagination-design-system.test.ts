import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("paginação operacional é compartilhada e tem nomes acessíveis", async () => {
  const [primitive, contacts, users, replies, agents, access] = await Promise.all([
    readFile("frontend/components/ui/Pagination.tsx", "utf8"),
    readFile("frontend/components/Contacts.tsx", "utf8"),
    readFile("frontend/components/Admin/UserManagement.tsx", "utf8"),
    readFile("frontend/components/Admin/QuickReplyManagement.tsx", "utf8"),
    readFile("frontend/components/Admin/AgentsManagement.tsx", "utf8"),
    readFile("frontend/components/Admin/BusinessAccessManagement.tsx", "utf8"),
  ]);

  assert.match(primitive, /aria-label=\{`Paginação de \$\{itemLabel\}`\}/);
  assert.match(primitive, /aria-label="Página anterior"/);
  assert.match(primitive, /aria-label="Próxima página"/);
  for (const source of [contacts, users, replies, agents, access]) {
    assert.match(source, /import \{ Pagination \}/);
    assert.match(source, /<Pagination page=\{page\}/);
  }
});
