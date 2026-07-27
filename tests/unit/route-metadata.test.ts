import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("cabeçalho aplica metadados de rota na aba e no breadcrumb", async () => {
  const source = await readFile("frontend/components/AppHeader.tsx", "utf8");

  assert.match(source, /document\.title = `\$\{meta\.title\} \| Mavo Talk`/);
  assert.match(source, /aria-label="Breadcrumb"/);
  assert.match(source, /const pageMeta/);
  assert.match(source, /\/admin\/menu-visibilidade/);
});
