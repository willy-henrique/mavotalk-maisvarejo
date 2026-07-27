import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("painel master mantém escala legível para dados operacionais claros", async () => {
  const [css, panel] = await Promise.all([
    readFile("app/globals.css", "utf8"),
    readFile("components/mavo-admin.tsx", "utf8"),
  ]);

  assert.match(css, /O painel master é o ambiente claro de governança/);
  assert.match(css, /\.master-section-heading h2, \.master-card-title h2 \{ font-size: 18px/);
  assert.match(css, /\.master-queue-overview strong \{ font-size: 12px/);
  assert.match(css, /\.master-audit-list p \{ color: #626c80; font-size: 10px/);
  assert.match(css, /\.master-shell \{ background: #eef1f7; color: #22263a/);
  assert.match(css, /\.master-bot-preview/);
  assert.match(panel, /Prévia da saudação no WhatsApp/);
  assert.match(panel, /assistente virtual do/);
});
