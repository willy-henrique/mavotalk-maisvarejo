import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("acessos gerenciais filtram no servidor dentro do tenant autenticado", async () => {
  const [route, repository, view] = await Promise.all([
    readFile("app/api/admin/business-access/route.ts", "utf8"),
    readFile("lib/business-access/business-access-repository.ts", "utf8"),
    readFile("frontend/components/Admin/BusinessAccessManagement.tsx", "utf8"),
  ]);

  assert.match(route, /searchParams\.get\("q"\)/);
  assert.match(route, /searchParams\.get\("role"\)/);
  assert.match(repository, /organization_id = \$1/);
  assert.match(repository, /name ILIKE/);
  assert.match(repository, /locked_until > now\(\)/);
  assert.match(view, /Buscar por nome ou telefone/);
  assert.match(view, /setPage\(1\)/);
  assert.match(view, /loadRequestRef/);
  assert.match(view, /request !== loadRequestRef\.current/);
});
