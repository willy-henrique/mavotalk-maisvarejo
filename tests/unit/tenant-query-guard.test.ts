import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");

test("consultas administrativas críticas executam com contexto RLS do tenant", async () => {
  const [db, audit, auditDetail, agents, menuSettings, supermarketSettings, analytics] = await Promise.all([
    read("lib/db.ts"),
    read("app/api/business/audit/route.ts"),
    read("app/api/business/audit/[id]/route.ts"),
    read("lib/agent-cloud/agent-repository.ts"),
    read("lib/menu-settings.ts"),
    read("lib/supermarket-settings.ts"),
    read("lib/business-analytics/business-analytics-service.ts"),
  ]);
  assert.match(db, /function queryTenantDatabase/);
  assert.match(db, /withTenantTransaction\(organizationId/);
  assert.doesNotMatch(audit, /queryDatabase/);
  assert.match(audit, /queryTenantDatabase/);
  assert.match(auditDetail, /queryTenantDatabase/);
  assert.match(agents, /queryTenantDatabase[\s\S]{0,120}organizationId/);
  assert.match(menuSettings, /queryTenantDatabase/);
  assert.doesNotMatch(menuSettings, /queryDatabase/);
  assert.match(supermarketSettings, /queryTenantDatabase/);
  assert.doesNotMatch(supermarketSettings, /queryDatabase/);
  assert.match(analytics, /queryTenantDatabase/);
  assert.doesNotMatch(analytics, /queryDatabase/);
});
