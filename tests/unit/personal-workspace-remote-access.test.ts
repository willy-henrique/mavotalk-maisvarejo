import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (file: string) => readFile(file, "utf8");

test("espaço pessoal mantém itens privados por usuário e tenant", async () => {
  const [migration, repository, routes] = await Promise.all([
    read("supabase/migrations/202609010025_personal_workspace_remote_access.sql"),
    read("lib/personal-workspace.ts"),
    read("app/api/personal-workspace/route.ts"),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS personal_workspace_items/);
  assert.match(migration, /owner_user_id TEXT NOT NULL/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(repository, /organization_id = \$1 AND owner_user_id = \$2/);
  assert.match(routes, /auth\.session\.userId/);
  assert.match(routes, /personal_workspace/);
});

test("cofre remoto cifra senha e não a inclui na listagem", async () => {
  const [repository, vault, reveal, migration] = await Promise.all([
    read("lib/remote-accesses.ts"),
    read("lib/remote-access-vault.ts"),
    read("app/api/remote-accesses/[id]/reveal/route.ts"),
    read("supabase/migrations/202609010025_personal_workspace_remote_access.sql"),
  ]);
  assert.match(vault, /aes-256-gcm/);
  assert.match(vault, /MAVO_REMOTE_ACCESS_ENCRYPTION_KEY/);
  assert.match(repository, /secret_ciphertext IS NOT NULL/);
  assert.match(repository, /reveal_secret/);
  assert.match(reveal, /"remote_accesses", "admin"/);
  assert.match(migration, /remote_access_audit/);
});

test("WhatsApp continua exclusivo de gestores e administradores", async () => {
  const [api, sidebar] = await Promise.all([
    read("lib/api.ts"),
    read("frontend/components/Sidebar.tsx"),
  ]);
  assert.match(api, /itemId === "painel" && session\.role === "atendente"/);
  assert.match(sidebar, /personal_workspace/);
  assert.match(sidebar, /remote_accesses/);
});
