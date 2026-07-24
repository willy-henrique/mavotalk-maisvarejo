import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");

test("falha do provedor impede persistência enganosa da mensagem de saída", async () => {
  const route = await read("app/api/conversations/[id]/messages/route.ts");
  const failureResponse = route.indexOf("Failed to deliver outbound WhatsApp message");
  const persistence = route.indexOf("const message = await addOutboundMessage");
  assert.ok(failureResponse >= 0);
  assert.ok(persistence > failureResponse);
  assert.match(route, /status:\s*503/);
});

test("upload valida tipo e limite e remove órfão quando a entrega falha", async () => {
  const route = await read("app/api/conversations/[id]/messages/upload/route.ts");
  assert.match(route, /MAX_IMAGE_BYTES\s*=\s*8\s*\*\s*1024\s*\*\s*1024/);
  assert.match(route, /ALLOWED_IMAGE_TYPES/);
  assert.match(route, /deleteCloudinaryResources\(\[upload\.public_id\]\)/);
  assert.match(route, /status:\s*413/);
  assert.match(route, /status:\s*503/);
});

test("mídia assinada exige vínculo da conversa com o tenant autenticado", async () => {
  const route = await read("app/api/media/signed/route.ts");
  assert.match(route, /conversationId/);
  assert.match(route, /auth\.session\.organizationId/);
  assert.match(route, /getCloudinaryPublicIdsForConversation/);
  assert.match(route, /allowedPublicIds\.includes\(publicId\)/);
});

test("novo contato após encerramento cria protocolo novo", async () => {
  const repository = await read("lib/supabase-repo.ts");
  const openHelper = repository.slice(
    repository.indexOf("async function getOpenConversation"),
    repository.indexOf("export async function getOpenConversationByContactId"),
  );
  assert.doesNotMatch(openHelper, /lastConv|status:\s*"aguardando"/);
  assert.match(openHelper, /\.in\("status", \["aguardando", "em_atendimento", "pendente_cliente"\]\)/);
});

test("contatos bloqueados são filtrados nos três canais de entrada", async () => {
  const sources = await Promise.all([
    read("lib/whatsapp-client.ts"),
    read("app/api/webhooks/twilio/route.ts"),
    read("app/api/webhooks/n8n/ticket-upsert/route.ts"),
  ]);
  for (const source of sources) {
    assert.match(source, /isContactBlocked/);
  }
});

test("QR e diagnóstico do WhatsApp são restritos a gestor e administrador", async () => {
  const route = await read("app/api/whatsapp/status/route.ts");
  assert.match(route, /requireRole\(\["admin", "gestor"\]/);
});

test("shutdown usa a API do Baileys", async () => {
  const server = await read("server.cjs");
  assert.match(server, /__waClient\.end\(undefined\)/);
  assert.doesNotMatch(server, /__waClient\.destroy\(\)/);
});

test("somente administrador altera contas e a última conta admin é protegida", async () => {
  const [collectionRoute, itemRoute] = await Promise.all([
    read("app/api/admin/users/route.ts"),
    read("app/api/admin/users/[id]/route.ts"),
  ]);
  assert.equal(
    [...collectionRoute.matchAll(/requireRole\(\["admin"\]/g)].length,
    2,
  );
  assert.equal(
    [...itemRoute.matchAll(/requireRole\(\["admin"\]/g)].length,
    2,
  );
  assert.match(itemRoute, /A organizacao deve manter ao menos um administrador ativo/);
});

test("métricas gerenciais não ficam disponíveis ao atendente por API direta", async () => {
  const route = await read("app/api/dashboard/metrics/route.ts");
  assert.match(route, /requireRole\(\["admin", "gestor"\]/);
});

test("banco serializa a proteção do último administrador por tenant", async () => {
  const migration = await read(
    "supabase/migrations/202607240007_protect_last_admin.sql",
  );
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /last_active_admin/);
  assert.match(migration, /BEFORE UPDATE OF role, is_active OR DELETE/);
});
