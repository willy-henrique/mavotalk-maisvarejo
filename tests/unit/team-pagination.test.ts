import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("equipe pagina resultados e retorna à primeira página ao alterar filtros", async () => {
  const source = await readFile("frontend/components/Admin/UserManagement.tsx", "utf8");

  assert.match(source, /const pageSize = 25/);
  assert.match(source, /const pagedUsers = filteredUsers\.slice/);
  assert.match(source, /\[searchTerm, roleFilter, statusFilter\]/);
  assert.match(source, /Mostrando \{\(activePage - 1\) \* pageSize \+ 1\}/);
});
