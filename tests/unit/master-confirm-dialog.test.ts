import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("sincronização master usa confirmação acessível em vez de diálogo nativo", async () => {
  const source = await readFile("components/mavo-admin.tsx", "utf8");

  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /syncTriggerRef/);
  assert.match(source, /Sincronizar filas/);
});

test("configuração do bot usa switches acessíveis em vez de checkboxes nativos", async () => {
  const source = await readFile("components/mavo-admin.tsx", "utf8");

  assert.doesNotMatch(source, /type="checkbox"/);
  assert.match(source, /role="switch"/);
  assert.match(source, /aria-checked=\{settingsDraft\.enabled\}/);
  assert.match(source, /aria-checked=\{settingsDraft\.aiFallbackEnabled\}/);
});

test("master avisa antes de descartar a configuração não salva", async () => {
  const source = await readFile("components/mavo-admin.tsx", "utf8");

  assert.match(source, /const settingsDirty =/);
  assert.match(source, /window\.addEventListener\("beforeunload", onBeforeUnload\)/);
  assert.match(source, /Descartar alterações não salvas\?/);
  assert.match(source, /Descartar e continuar/);
  assert.match(source, /Alterações não salvas/);
});
