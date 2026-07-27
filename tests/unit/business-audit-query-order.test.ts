import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("auditoria passa o tenant antes do SQL em todas as consultas estritas", async () => {
  const source = await readFile("app/api/business/audit/route.ts", "utf8");

  const strictCalls = source.match(/queryTenantDatabase[\s\S]*?\),\n\s*queryTenantDatabase/g) || [];
  assert.equal(strictCalls.length, 1, "a lista e a contagem devem usar consultas estritas");
  assert.match(source, /queryTenantDatabase<[\s\S]*?>\(\s*auth\.session\.organizationId,\s*`SELECT a\.id/);
  assert.match(source, /queryTenantDatabase<\{ count: string \}>\(\s*auth\.session\.organizationId,\s*`SELECT COUNT/);
});
