import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");

test("consultas administrativas críticas executam com contexto RLS do tenant", async () => {
  const [db, shim, repository, audit, auditDetail, agents, menuSettings, supermarketSettings, analytics, businessAccess] = await Promise.all([
    read("lib/db.ts"),
    read("lib/postgres-supabase-shim.ts"),
    read("lib/supabase-repo.ts"),
    read("app/api/business/audit/route.ts"),
    read("app/api/business/audit/[id]/route.ts"),
    read("lib/agent-cloud/agent-repository.ts"),
    read("lib/menu-settings.ts"),
    read("lib/supermarket-settings.ts"),
    read("lib/business-analytics/business-analytics-service.ts"),
    read("lib/business-access/business-access-repository.ts"),
  ]);
  assert.match(db, /function queryTenantDatabase/);
  assert.match(db, /withTenantTransaction\(organizationId/);
  assert.match(shim, /createTenantPostgresSupabaseShim/);
  assert.match(shim, /queryTenantDatabase<T>\(organizationId, sql, values\)/);
  assert.match(repository, /function supa\(organizationId\?: string\)/);
  assert.doesNotMatch(repository, /\bsupa\(\)/, "o repositório não pode executar consultas operacionais sem tenant");
  for (const name of ["createUser", "updateUser", "recordUserLogin", "createQueue", "updateQueue", "deleteQueue", "createQuickReply", "updateQuickReply", "deleteQuickReply", "listConversations", "getConversation", "assignConversation", "closeConversation", "addOutboundMessage", "addInboundMessage", "findMessageByExternalId", "getCloudinaryPublicIdsForConversation", "getContactById", "getContactByPhone", "getOrCreateContact", "updateContact", "getOrCreateOpenConversation", "getOrCreateContactAndOpenConversation", "updateConversationById", "updateTicketByConversation", "dashboardMetrics", "getBusinessHour", "recordSatisfactionRatingByPhone"]) {
    const start = repository.indexOf(`export async function ${name}`);
    const end = repository.indexOf("export async function", start + 1);
    assert.ok(start >= 0, `${name} deve existir no repositório`);
    const source = repository.slice(start, end < 0 ? undefined : end);
    assert.match(source, name === "getOrCreateOpenConversation" ? /withTenantTransaction\(orgId/ : /supa\(orgId\)/, `${name} deve executar sob o tenant resolvido`);
  }
  const openConversationStart = repository.indexOf("export async function getOrCreateOpenConversation");
  const openConversationEnd = repository.indexOf("export async function", openConversationStart + 1);
  const openConversationSource = repository.slice(openConversationStart, openConversationEnd);
  assert.match(openConversationSource, /pg_advisory_xact_lock/);
  assert.match(openConversationSource, /INSERT INTO tickets/);
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
  assert.match(businessAccess, /queryTenantDatabase/);
  assert.doesNotMatch(businessAccess, /queryDatabase/);
});
