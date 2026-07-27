import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("painel master valida a organização antes de consultar ou alterar outro tenant", async () => {
  const [scope, overview, adminAuth, ui, settings] = await Promise.all([
    readFile("lib/mavo-organization-scope.ts", "utf8"),
    readFile("app/api/mavo/overview/route.ts", "utf8"),
    readFile("lib/supermarket-admin-auth.ts", "utf8"),
    readFile("components/mavo-admin.tsx", "utf8"),
    readFile("app/api/admin/supermarket-settings/route.ts", "utf8"),
  ]);
  assert.match(scope, /WHERE id = \$1 LIMIT 1/);
  assert.match(scope, /ORDER BY name ASC, id ASC LIMIT 200/);
  assert.match(overview, /resolveMavoOrganization/);
  assert.match(overview, /Organização não encontrada/);
  assert.match(adminAuth, /if \(appAuth\.session\)/);
  assert.match(adminAuth, /x-mavo-organization-id/);
  assert.match(adminAuth, /resolveMavoOrganization/);
  assert.match(ui, /\/api\/mavo\/organizations/);
  assert.match(ui, /X-Mavo-Organization-Id/);
  assert.match(settings, /origin: auth\.session\.userId \? "operational-admin" : "mavo-master"/);
  assert.match(settings, /updateSupermarketConfiguration/);
});
