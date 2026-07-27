import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("indicadores ignoram respostas atrasadas ao trocar período ou consulta", async () => {
  const source = await readFile("frontend/components/BusinessAnalytics.tsx", "utf8");

  assert.match(source, /loadRequestRef/);
  assert.match(source, /queryRequestRef/);
  assert.match(source, /request !== loadRequestRef\.current/);
  assert.match(source, /request !== queryRequestRef\.current/);
});
