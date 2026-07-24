import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");

test("entrada WhatsApp decide Cliente 1/Cliente 2 antes de criar ticket", async () => {
  const [twilio, ticketUpsert, unofficial] = await Promise.all([
    read("app/api/webhooks/twilio/route.ts"),
    read("app/api/webhooks/n8n/ticket-upsert/route.ts"),
    read("lib/whatsapp-client.ts"),
  ]);
  assert.ok(
    twilio.lastIndexOf("routeBusinessWhatsappMessage") <
      twilio.lastIndexOf("getOrCreateContactAndOpenConversation"),
  );
  assert.ok(
    ticketUpsert.lastIndexOf("routeBusinessWhatsappMessage") <
      ticketUpsert.lastIndexOf("getOrCreateContactAndOpenConversation"),
  );
  assert.ok(
    unofficial.lastIndexOf("routeBusinessWhatsappMessage") <
      unofficial.lastIndexOf("getOrCreateContactAndOpenConversation"),
  );
});

test("Socket.IO autentica o cookie e transmite somente na sala do tenant", async () => {
  const server = await read("server.cjs");
  const realtime = await read("lib/realtime.ts");
  assert.match(server, /jwtVerify/);
  assert.match(server, /organization:\$\{socket\.data\.organizationId\}/);
  assert.doesNotMatch(server, /\bio\.emit\(/);
  assert.match(
    realtime,
    /\.to\(organizationRoom\(organizationId\)\)\.emit/,
  );
});

test("camada oficial de repositório não faz fallback para Firestore", async () => {
  const repository = await read("lib/repo.ts");
  assert.doesNotMatch(repository, /firestore-repo/);
  assert.doesNotMatch(repository, /catch[\s\S]{0,200}firestore/i);
  assert.match(repository, /DB_PROVIDER/);
  assert.match(repository, /supabase/);
});

test("migrations e consultas analíticas carregam organization_id", async () => {
  const [access, agent, analytics, service] = await Promise.all([
    read("supabase/migrations/202607230001_business_access.sql"),
    read("supabase/migrations/202607230002_agent_cloud.sql"),
    read("supabase/migrations/202607230003_business_analytics.sql"),
    read("lib/business-analytics/business-analytics-service.ts"),
  ]);
  for (const migration of [access, agent, analytics]) {
    assert.match(migration, /organization_id/);
  }
  assert.match(service, /WHERE organization_id = \$1/);
  assert.doesNotMatch(service, /execute_sql/i);
});

test("credencial do agente resolve o tenant sem confiar no payload", async () => {
  const auth = await read("lib/agent-cloud/agent-auth-service.ts");
  const schemas = await read("lib/agent-cloud/agent-payload-schemas.ts");
  assert.match(auth, /organizationId: credential\.organizationId/);
  assert.doesNotMatch(schemas, /organizationId|organization_id/);
});

test("modo suporte sobrevive à expiração sem reabrir sessão gerencial", async () => {
  const [repository, sessionService, router] = await Promise.all([
    read("lib/business-access/business-access-repository.ts"),
    read("lib/business-access/business-session-service.ts"),
    read("lib/business-access/business-whatsapp-router.ts"),
  ]);
  assert.match(repository, /s\.support_mode_until > now\(\)/);
  assert.match(sessionService, /authenticated: boolean/);
  assert.match(router, /businessSessionAuthenticated/);
  assert.match(router, /pinChallengeMessage\(\)/);
});
