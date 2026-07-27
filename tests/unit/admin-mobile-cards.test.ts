import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("tabelas administrativas críticas preservam ações em cartões no mobile", async () => {
  const [users, replies, access] = await Promise.all([
    readFile("frontend/components/Admin/UserManagement.tsx", "utf8"),
    readFile("frontend/components/Admin/QuickReplyManagement.tsx", "utf8"),
    readFile("frontend/components/Admin/BusinessAccessManagement.tsx", "utf8"),
  ]);

  for (const source of [users, replies, access]) {
    assert.match(source, /hidden overflow-x-auto[\s\S]*md:block/);
    assert.match(source, /grid gap-3 md:hidden/);
  }
  assert.match(users, /Último login/);
  assert.match(replies, /Editar \$\{item\.name\}/);
  assert.match(access, /Revogar sessões/);
  assert.match(access, /Permissões/);
});
