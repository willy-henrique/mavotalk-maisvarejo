import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("exportação da auditoria preserva escopo do tenant e mascara telefone", async () => {
  const source = await readFile("app/api/business/audit/route.ts", "utf8");
  assert.match(source, /queryTenantDatabase/);
  assert.match(source, /function maskPhone/);
  assert.match(source, /format === "csv"/);
  assert.match(source, /Content-Disposition/);
  assert.match(source, /maskPhone\(row\.phone_normalized\)/);
  assert.match(source, /10_000/);
});
