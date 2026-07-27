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
