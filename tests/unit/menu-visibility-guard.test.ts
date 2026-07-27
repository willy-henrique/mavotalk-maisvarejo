import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("visibilidade do menu não concede funções fora do papel", async () => {
  const source = await readFile("frontend/components/Sidebar.tsx", "utf8");
  const roleCheck = source.indexOf("const roleAllowed");
  const visibilityCheck = source.indexOf("return !visibilityOverrides");

  assert.ok(roleCheck >= 0, "Sidebar precisa calcular autorização por papel");
  assert.ok(visibilityCheck > roleCheck, "visibilidade deve ser avaliada após o papel");
  assert.match(source, /if \(!roleAllowed\) return false/);
});
