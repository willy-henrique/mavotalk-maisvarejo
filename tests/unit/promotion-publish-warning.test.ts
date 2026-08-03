import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("o editor avisa que promoções não publicadas não chegam ao bot", async () => {
  const manager = await readFile("frontend/components/Admin/QueuePromotionManager.tsx", "utf8");
  assert.match(manager, /published: boolean/);
  assert.match(manager, /Estas promoções ainda não chegam ao bot/);
  assert.match(manager, /published \? 'Conteúdo publicado' : 'Conteúdo não publicado'/);
  assert.match(manager, /não publicada/);
});

test("o drawer informa ao gerenciador se a fila está publicada", async () => {
  const drawer = await readFile("frontend/components/Admin/QueueAutomationDrawer.tsx", "utf8");
  assert.match(drawer, /<QueuePromotionManager[^>]*published=\{Boolean\(data\?\.published\)\}/);
});
