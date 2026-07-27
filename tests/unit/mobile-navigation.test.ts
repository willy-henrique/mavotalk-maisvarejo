import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("drawer de navegação móvel fecha com Escape", async () => {
  const source = await readFile("frontend/App.tsx", "utf8");

  assert.match(source, /if \(!sidebarOpen\) return/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /setSidebarOpen\(false\)/);
  assert.match(source, /window\.addEventListener\('keydown', closeOnEscape\)/);
});
