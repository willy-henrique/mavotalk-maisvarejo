import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("último login é persistido por tenant sem bloquear autenticação", async () => {
  const [migration, repository, login] = await Promise.all([
    readFile("supabase/migrations/202607270002_user_last_login.sql", "utf8"),
    readFile("lib/supabase-repo.ts", "utf8"),
    readFile("app/api/auth/login/route.ts", "utf8"),
  ]);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS last_login_at/);
  assert.match(repository, /function recordUserLogin/);
  assert.match(repository, /\.eq\("organization_id", orgId\)/);
  assert.match(repository, /catch \(error\)/);
  assert.match(login, /await recordUserLogin\(String\(user\.organizationId\), String\(user\.id\)\)/);
});
