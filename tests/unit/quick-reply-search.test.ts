import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("respostas rápidas suportam busca e paginação sem perder o estado vazio", async () => {
  const source = await readFile("frontend/components/Admin/QuickReplyManagement.tsx", "utf8");

  assert.match(source, /Buscar respostas rápidas/);
  assert.match(source, /const filteredItems = items\.filter/);
  assert.match(source, /const pagedItems = filteredItems\.slice/);
  assert.match(source, /Nenhuma resposta encontrada/);
  assert.match(source, /Mostrando \{\(activePage - 1\) \* pageSize \+ 1\}/);
});
