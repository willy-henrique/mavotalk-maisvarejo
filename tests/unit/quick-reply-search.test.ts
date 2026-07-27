import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("respostas rápidas usam busca e paginação no servidor sem perder o estado vazio", async () => {
  const [source, route, repository] = await Promise.all([
    readFile("frontend/components/Admin/QuickReplyManagement.tsx", "utf8"),
    readFile("app/api/quick-replies/route.ts", "utf8"),
    readFile("lib/supabase-repo.ts", "utf8"),
  ]);

  assert.match(source, /Buscar respostas rápidas/);
  assert.match(source, /URLSearchParams/);
  assert.match(source, /deferredSearch/);
  assert.match(source, /Nenhuma resposta encontrada/);
  assert.match(source, /Mostrando \{total \? \(activePage - 1\) \* pageSize \+ 1 : 0\}/);
  assert.match(route, /listQuickRepliesPage\(auth\.session\.organizationId/);
  assert.match(repository, /queryTenantDatabase<QuickReplyPageRow>/);
  assert.match(repository, /content ILIKE/);
});
