import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");

test("consultas administrativas críticas executam com contexto RLS do tenant", async () => {
  const [db, audit, auditDetail, agents] = await Promise.all([
    read("lib/db.ts"),
    read("app/api/business/audit/route.ts"),
    read("app/api/business/audit/[id]/route.ts"),
    read("lib/agent-cloud/agent-repository.ts"),
  ]);
  assert.match(db, /function queryTenantDatabase/);
  assert.match(db, /withTenantTransaction\(organizationId/);
  assert.doesNotMatch(audit, /queryDatabase/);
  assert.match(audit, /queryTenantDatabase/);
  assert.match(auditDetail, /queryTenantDatabase/);
  assert.match(agents, /queryTenantDatabase[\s\S]{0,120}organizationId/);
});
