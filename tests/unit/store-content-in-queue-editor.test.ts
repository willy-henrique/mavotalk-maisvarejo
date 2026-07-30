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

test("conteúdo de ofertas só aparece ao editar a fila de menuOption 1", async () => {
  const source = await readFile("frontend/components/Admin/TicketTypeManagement.tsx", "utf8");

  assert.match(source, /editingId && formMenuOption === 1/);
  assert.match(source, /formOffersText/);
  assert.match(source, /formOffersUrl/);
  assert.match(source, /uploadOffersImage/);
  assert.match(source, /removeOffersImage/);
  assert.match(source, /\/api\/admin\/supermarket-settings\/offers-image/);
});

test("conteúdo de endereço/horários só aparece ao editar a fila de menuOption 2", async () => {
  const source = await readFile("frontend/components/Admin/TicketTypeManagement.tsx", "utf8");

  assert.match(source, /editingId && formMenuOption === 2/);
  assert.match(source, /formAddress/);
  assert.match(source, /formMapsUrl/);
  assert.match(source, /formPhone/);
  assert.match(source, /formHours\.map/);
  assert.match(source, /WEEKDAY_NAMES/);
});

test("salvar a fila também persiste o conteúdo de autoatendimento correspondente", async () => {
  const source = await readFile("frontend/components/Admin/TicketTypeManagement.tsx", "utf8");
  const handleSubmit = source.slice(source.indexOf("const handleSubmit"), source.indexOf("const restoreDefaultMenu"));

  assert.match(handleSubmit, /if \(formMenuOption === 1\)/);
  assert.match(handleSubmit, /offersText: formOffersText\.trim\(\)/);
  assert.match(handleSubmit, /else if \(formMenuOption === 2\)/);
  assert.match(handleSubmit, /businessHours: formHours/);
});
