import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("contatos pesquisam e paginam no servidor dentro do tenant autenticado", async () => {
  const [route, repository, view] = await Promise.all([
    readFile("app/api/contacts/route.ts", "utf8"),
    readFile("lib/supabase-repo.ts", "utf8"),
    readFile("frontend/components/Contacts.tsx", "utf8"),
  ]);

  assert.match(route, /searchParams\.get\("q"\)/);
  assert.match(route, /status === "blocked"/);
  assert.match(route, /listContactsPage\(auth\.session\.organizationId/);
  assert.match(repository, /queryTenantDatabase<ContactPageRow>/);
  assert.match(repository, /c\.organization_id = \$1/);
  assert.match(repository, /LEFT JOIN LATERAL/);
  assert.match(repository, /c\.name ILIKE[\s\S]*c\.phone_number ILIKE/);
  assert.match(repository, /c\.blocked = \$\$\{values\.length\}/);
  assert.match(repository, /LIMIT \$\$\{values\.length \+ 1\} OFFSET/);
  assert.match(view, /URLSearchParams/);
  assert.match(view, /deferredSearch/);
  assert.match(view, /Estado do contato/);
  assert.match(view, /md:hidden/);
  assert.match(view, /import \{ Pagination \} from '\.\/ui\/Pagination'/);
  assert.match(view, /<Pagination page=\{page\} pageSize=\{pageSize\} total=\{total\} itemLabel="contatos"/);
  assert.doesNotMatch(view, /const filtered = contacts\.filter/);
});
