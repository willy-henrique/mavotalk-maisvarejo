import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const read = (relative: string) => readFile(path.resolve(relative), "utf8");

/**
 * O balão do painel imprimia "Nome:" em toda mensagem enviada, sem olhar o botão de
 * assinatura: o técnico desligava a assinatura, o cliente parava de ver o nome no
 * WhatsApp e o painel continuava mostrando. Agora cada mensagem guarda se foi assinada.
 */
test("a mensagem guarda se foi assinada", async () => {
  const [migration, repo] = await Promise.all([
    read("supabase/migrations/202608210021_message_with_signature.sql"),
    read("lib/supabase-repo.ts"),
  ]);

  assert.match(migration, /ALTER TABLE messages/i);
  assert.match(migration, /with_signature/);

  // Gravação: o valor resolvido no envio precisa chegar ao insert.
  assert.match(repo, /with_signature: /);
  assert.match(repo, /withSignature\?: boolean/);
  // Leitura: a listagem devolve o campo para o painel decidir o que mostrar.
  assert.match(repo, /withSignature: /);
});

test("as rotas de envio repassam a assinatura resolvida para o banco", async () => {
  const [textRoute, uploadRoute, startRoute] = await Promise.all([
    read("app/api/conversations/[id]/messages/route.ts"),
    read("app/api/conversations/[id]/messages/upload/route.ts"),
    read("app/api/conversations/route.ts"),
  ]);

  assert.match(textRoute, /withSignature: useSignature/);
  assert.match(uploadRoute, /withSignature: useSignature/);
  assert.match(startRoute, /withSignature: agentSignatureEnabled/);
});

test("o balão só mostra o nome do atendente quando a mensagem foi assinada", async () => {
  const inbox = await read("frontend/components/InboxConversations.tsx");

  assert.match(inbox, /withSignature\?: boolean/);
  // Nenhum ponto do balão pode imprimir o nome olhando só para authorName.
  assert.doesNotMatch(inbox, /m\.direction === 'outbound' && m\.authorName/);
  assert.match(inbox, /m\.withSignature && m\.authorName/);
});

test("a escolha de assinatura do atendente sobrevive à recarga", async () => {
  const inbox = await read("frontend/components/InboxConversations.tsx");

  assert.match(inbox, /function readStoredSignature/);
  assert.match(inbox, /function storeSignature/);
  assert.match(inbox, /storeSignature\(currentUser\.id, next\)/);
  // O padrão da loja não pode sobrescrever quem já escolheu.
  assert.match(inbox, /storedSignature === null &&/);
});
