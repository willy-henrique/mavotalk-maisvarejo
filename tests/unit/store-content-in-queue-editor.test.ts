import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("bloco global de identidade do bot fica fora do modal de fila e salva via supermarket-settings", async () => {
  const source = await readFile("frontend/components/Admin/TicketTypeManagement.tsx", "utf8");

  assert.match(source, /Identidade e automação do bot/);
  assert.match(source, /identityBotName/);
  assert.match(source, /identityStoreName/);
  assert.match(source, /saveIdentity/);
  assert.match(source, /apiPatch<\{ settings: StoreSettings \}>\('\/api\/admin\/supermarket-settings', \{\s*botName,\s*storeName,/);
});

test("conteúdo de ofertas é configurado no editor dedicado da automação", async () => {
  const source = await readFile("frontend/components/Admin/QueueAutomationDrawer.tsx", "utf8");

  assert.match(source, /config\.queueType === 'offers_promotions'/);
  assert.match(source, /QueuePromotionManager/);
  assert.match(source, /Salvar rascunho/);
  assert.match(source, /Publicar alterações/);
});

test("endereço e horários são configurados no editor dedicado da automação", async () => {
  const source = await readFile("frontend/components/Admin/QueueAutomationDrawer.tsx", "utf8");

  assert.match(source, /config\.queueType === 'business_hours_location'/);
  assert.match(source, /Salvar unidade e horários/);
  assert.match(source, /location\/hours/);
  assert.match(source, /Exceções e datas especiais/);
});

test("salvar dados básicos não publica nem sobrescreve o conteúdo da automação", async () => {
  const source = await readFile("frontend/components/Admin/TicketTypeManagement.tsx", "utf8");
  const handleSubmit = source.slice(source.indexOf("const handleSubmit"), source.indexOf("const restoreDefaultMenu"));

  assert.match(handleSubmit, /apiPatch\(`\/api\/queues\/\$\{editingId\}`/);
  assert.match(handleSubmit, /apiPost<\{ queue: Queue \}>\('\/api\/queues', body\)/);
  assert.doesNotMatch(handleSubmit, /supermarket-settings/);
  assert.doesNotMatch(handleSubmit, /Publicar alterações/);
});
