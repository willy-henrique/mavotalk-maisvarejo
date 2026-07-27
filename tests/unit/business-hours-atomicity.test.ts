import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("horários da organização são persistidos em um único upsert tenant-scoped", async () => {
  const source = await readFile("lib/supermarket-settings.ts", "utf8");

  assert.match(source, /jsonb_to_recordset\(\$2::jsonb\)/);
  assert.match(source, /INSERT INTO business_hours[\s\S]*ON CONFLICT \(organization_id, weekday\)/);
  assert.match(source, /queryTenantDatabase\(/);
  assert.doesNotMatch(source, /for \(const hour of hours\)[\s\S]{0,500}INSERT INTO business_hours/);
});
