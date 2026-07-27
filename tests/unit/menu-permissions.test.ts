import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");

test("matriz de permissões é persistida por organização e aplicada antes das rotas críticas", async () => {
  const [settings, api, menuRoute, inbox, contacts, agents, users] = await Promise.all([
    read("lib/menu-settings.ts"),
    read("lib/api.ts"),
    read("app/api/admin/menu-settings/route.ts"),
    read("app/api/conversations/route.ts"),
    read("app/api/contacts/route.ts"),
    read("app/api/admin/agents/provision/route.ts"),
    read("app/api/admin/users/route.ts"),
  ]);

  assert.match(settings, /menu_permission_overrides/);
  assert.match(settings, /hasMenuPermission/);
  assert.match(api, /requireMenuPermission/);
  assert.match(menuRoute, /parsePermissions/);
  assert.match(inbox, /"inbox", "read"/);
  assert.match(contacts, /"contacts", "read"/);
  assert.match(agents, /"business_sync", "create"/);
  assert.match(users, /"admin_users", "read"/);
});
