import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("equipe filtra e pagina no servidor dentro do tenant autenticado", async () => {
  const [route, repository, view] = await Promise.all([
    readFile("app/api/admin/users/route.ts", "utf8"),
    readFile("lib/supabase-repo.ts", "utf8"),
    readFile("frontend/components/Admin/UserManagement.tsx", "utf8"),
  ]);

  assert.match(route, /searchParams\.get\("q"\)/);
  assert.match(route, /listUsersPage\(auth\.session\.organizationId/);
  assert.match(repository, /queryTenantDatabase<UserPageRow>/);
  assert.match(repository, /organization_id = \$1/);
  assert.match(repository, /name ILIKE[\s\S]*email ILIKE/);
  assert.match(repository, /LIMIT \$\$\{values\.length \+ 1\} OFFSET/);
  assert.match(view, /URLSearchParams/);
  assert.match(view, /deferredSearch/);
  assert.doesNotMatch(view, /const filteredUsers = users\.filter/);
});
