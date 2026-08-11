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

test("QR e diagnóstico do WhatsApp são restritos por permissão de painel no servidor", async () => {
  const [route, settings] = await Promise.all([
    read("app/api/whatsapp/status/route.ts"),
    read("lib/menu-settings.ts"),
  ]);
  assert.match(route, /requireMenuPermission\(auth\.session, "painel", "read"\)/);
  assert.match(settings, /painel: \{ read: CAN_MANAGE/);
});

test("desconectar desloga o aparelho e apaga a sessão antes de um novo QR", async () => {
  const [client, route] = await Promise.all([
    read("lib/whatsapp-client.ts"),
    read("app/api/whatsapp/disconnect/route.ts"),
  ]);

  // O painel precisa pedir o desligamento completo: só encerrar o socket mantém as
  // credenciais registradas e o Baileys reconecta sozinho no número anterior.
  assert.match(route, /destroyWhatsappClient\(\{\s*logout:\s*true\s*\}\)/);

  const destroy = client.slice(client.indexOf("export async function destroyWhatsappClient"));
  assert.match(destroy, /sock\.logout\(\)/);
  assert.match(destroy, /clearWhatsappAuthState\(\)/);

  // A limpeza da sessão persistida precisa acontecer depois do logout, senão o
  // socket ainda vivo regrava as credenciais que acabaram de ser removidas.
  assert.ok(destroy.indexOf("sock.logout()") < destroy.indexOf("clearWhatsappAuthState()"));

  // Um `creds.update` atrasado do socket antigo ressuscitaria a sessão apagada.
  assert.match(client, /if \(generation !== currentWhatsappGeneration\(\)\) return;\s*void saveCreds\(\)/);

  // Falha ao limpar não pode ser reportada como sucesso: o QR seguinte reconectaria o número antigo.
  assert.match(route, /status:\s*500/);
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
  assert.match(collectionRoute, /"admin_users", "read"/);
  assert.match(collectionRoute, /"admin_users", "create"/);
  assert.match(itemRoute, /"admin_users", "update"/);
  assert.match(itemRoute, /"admin_users", "delete"/);
  assert.match(itemRoute, /A organizacao deve manter ao menos um administrador ativo/);
});

test("métricas gerenciais não ficam disponíveis ao atendente por API direta", async () => {
  const [route, settings] = await Promise.all([
    read("app/api/dashboard/metrics/route.ts"),
    read("lib/menu-settings.ts"),
  ]);
  assert.match(route, /requireMenuPermission\(auth\.session, "dashboard", "read"\)/);
  assert.match(settings, /dashboard: \{ read: CAN_MANAGE/);
});

test("banco serializa a proteção do último administrador por tenant", async () => {
  const migration = await read(
    "supabase/migrations/202607240007_protect_last_admin.sql",
  );
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /last_active_admin/);
  assert.match(migration, /BEFORE UPDATE OF role, is_active OR DELETE/);
});

test("preset do supermercado só faz bootstrap quando o tenant não tem nenhuma fila, não a cada mensagem", async () => {
  const route = await read("app/api/webhooks/n8n/ticket-upsert/route.ts");
  assert.doesNotMatch(route, /isSupermarketQueuePresetApplied/);
  assert.match(route, /supermarketQueuesReady = allQueues\.length > 0/);
  assert.match(route, /activeMenuOptions: queues\.map/);

  const setup = await read("lib/supermarket-setup.ts");
  assert.doesNotMatch(setup, /isSupermarketQueuePresetApplied/);
});
