import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("equipe usa a paginação do servidor e retorna à primeira página ao alterar filtros", async () => {
  const source = await readFile("frontend/components/Admin/UserManagement.tsx", "utf8");

  assert.match(source, /const pageSize = 25/);
  assert.match(source, /page: String\(page\)/);
  assert.match(source, /setTotal\(/);
  assert.match(source, /\[searchTerm, roleFilter, statusFilter\]/);
  assert.match(source, /import \{ Pagination \} from '\.\.\/ui\/Pagination'/);
  assert.match(source, /<Pagination page=\{page\} pageSize=\{pageSize\} total=\{total\} itemLabel="colaboradores"/);
});
