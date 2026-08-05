import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

/**
 * As promoções passaram a viver dentro da fila de Ofertas, onde têm flyer,
 * validade e publicação. A tela antiga cadastrava promoção sem fila nenhuma —
 * e o que ela criava nunca chegava ao cliente.
 */
test("a tela antiga de Promoções saiu do painel", async () => {
  const [app, sidebar, menuSettings] = await Promise.all([
    readFile("frontend/App.tsx", "utf8"),
    readFile("frontend/components/Sidebar.tsx", "utf8"),
    readFile("lib/menu-settings.ts", "utf8"),
  ]);

  await assert.rejects(access("frontend/components/Promotions.tsx"));
  assert.doesNotMatch(sidebar, /admin_promotions/);
  assert.doesNotMatch(menuSettings, /admin_promotions/);
  assert.doesNotMatch(app, /<Promotions \/>/);
  // Link antigo continua funcionando, agora apontando para onde as ofertas moram.
  assert.match(app, /path="\/admin\/promocoes" element=\{<Navigate to="\/admin\/tipos" replace \/>\}/);
});

test("o bot mantém o fallback das promoções legadas já cadastradas", async () => {
  const webhook = await readFile("app/api/webhooks/n8n/ticket-upsert/route.ts", "utf8");

  // Remover a tela não pode calar ofertas que tenants antigos já publicaram.
  assert.match(webhook, /listValidPromotions\(organizationId\)/);
});
