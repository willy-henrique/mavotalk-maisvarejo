import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");

test("contato pode desativar somente o bot sem ser bloqueado", async () => {
  const [migration, schema, repository, route, contacts, verification] = await Promise.all([
    read("supabase/migrations/202608170020_contact_bot_disabled.sql"),
    read("lib/schemas.ts"),
    read("lib/supabase-repo.ts"),
    read("app/api/contacts/[id]/route.ts"),
    read("frontend/components/Contacts.tsx"),
    read("scripts/db-verify.mjs"),
  ]);

  assert.match(migration, /bot_disabled BOOLEAN NOT NULL DEFAULT false/);
  assert.match(schema, /botDisabled: z\.boolean\(\)\.optional\(\)/);
  assert.match(repository, /export async function getContactInboundPolicy/);
  assert.match(repository, /select\("blocked, bot_disabled"\)/);
  assert.match(repository, /botDisabled: Boolean\(row\.bot_disabled\)/);
  assert.match(repository, /updates\.bot_disabled = payload\.botDisabled/);
  assert.match(route, /payload\.botDisabled = parsed\.data\.botDisabled/);
  assert.match(contacts, /botDisabled: !contact\.botDisabled/);
  assert.match(contacts, /Desativar bot/);
  assert.match(contacts, /Ativar bot/);
  assert.match(contacts, /As mensagens continuam chegando ao Inbox/);
  assert.match(verification, /column_name = 'bot_disabled'/);
});

test("todas as entradas automáticas respeitam o bot desativado e preservam o Inbox", async () => {
  const [ticketUpsert, whatsapp, twilio, cerebro, closeRoute] = await Promise.all([
    read("app/api/webhooks/n8n/ticket-upsert/route.ts"),
    read("lib/whatsapp-client.ts"),
    read("app/api/webhooks/twilio/route.ts"),
    read("lib/cerebro-auto-reply.ts"),
    read("app/api/conversations/[id]/close/route.ts"),
  ]);

  const disabledBranch = ticketUpsert.indexOf("if (botDisabled)");
  const supermarketBranch = ticketUpsert.indexOf("else if (supermarketDecision)");
  const inboundPersistence = ticketUpsert.indexOf("const inbound = await addInboundMessage");
  assert.ok(inboundPersistence >= 0 && disabledBranch > inboundPersistence);
  assert.ok(supermarketBranch > disabledBranch);
  assert.match(ticketUpsert, /reason: "contact_blocked"/);
  assert.match(ticketUpsert, /decisionReason = "contact_bot_disabled"/);
  assert.match(ticketUpsert, /getContactInboundPolicy\(organizationId, replyPhone\)/);
  assert.match(ticketUpsert, /Skipped automatic reply after refreshing contact policy/);

  assert.match(whatsapp, /suppressReply: isPreConnectionQueued \|\| inboundContactPolicy\.botDisabled/);
  assert.match(whatsapp, /if \(contactPolicy\.botDisabled\)[\s\S]*?Inbound WhatsApp message persisted without automatic reply/);
  assert.match(whatsapp, /!inboundContactPolicy\.botDisabled[\s\S]*?Obrigado pela sua avaliação/);

  assert.match(twilio, /metadata: contactPolicy\.botDisabled \? \{ suppress_reply: true \}/);
  assert.match(twilio, /if \(contactPolicy\.botDisabled\)[\s\S]*?return emptyTwiML\(\)/);
  assert.match(cerebro, /contactPolicy\.blocked \|\| contactPolicy\.botDisabled/);
  assert.match(cerebro, /"contact_bot_disabled"/);
  assert.match(closeRoute, /!contactPolicy\.botDisabled/);
});

test("bot desativado não impede a resposta manual do atendente", async () => {
  const [textRoute, uploadRoute, newConversationRoute] = await Promise.all([
    read("app/api/conversations/[id]/messages/route.ts"),
    read("app/api/conversations/[id]/messages/upload/route.ts"),
    read("app/api/conversations/route.ts"),
  ]);

  for (const route of [textRoute, uploadRoute, newConversationRoute]) {
    assert.doesNotMatch(route, /botDisabled|bot_disabled|getContactInboundPolicy/);
  }
});

test("foto do contato abre ampliada dentro da plataforma", async () => {
  const [preview, inbox, contacts, dialog] = await Promise.all([
    read("frontend/components/ui/AvatarPreviewDialog.tsx"),
    read("frontend/components/InboxConversations.tsx"),
    read("frontend/components/Contacts.tsx"),
    read("frontend/components/ui/Dialog.tsx"),
  ]);

  assert.match(preview, /<Dialog/);
  assert.match(preview, /size="wide"/);
  assert.match(preview, /max-h-\[72vh\]/);
  assert.match(preview, /referrerPolicy="no-referrer"/);
  assert.match(preview, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(inbox, /aria-label=\{`Ampliar foto de/);
  assert.match(inbox, /<AvatarPreviewDialog/);
  assert.match(contacts, /onPreview=\{setAvatarPreview\}/);
  assert.match(contacts, /<AvatarPreviewDialog/);
  assert.match(dialog, /event\.key === 'Escape'/);
});
