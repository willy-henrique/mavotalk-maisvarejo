import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("agentes exibem uma ação recomendada sem expor dados de rede", async () => {
  const source = await readFile("frontend/components/Admin/AgentsManagement.tsx", "utf8");

  assert.match(source, /const recommendedAction/);
  assert.match(source, /Ação recomendada/);
  assert.match(source, /Abrir logs e corrigir a última falha/);
  assert.doesNotMatch(source, /ipAddress|remoteAddress/);
});
