import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("filas oferecem busca, filtro de status e tabela para volume operacional", async () => {
  const source = await readFile("frontend/components/Admin/TicketTypeManagement.tsx", "utf8");

  assert.match(source, /Buscar filas/);
  assert.match(source, /statusFilter/);
  assert.match(source, /filteredQueues\.length > 8/);
  assert.match(source, /Nenhuma fila encontrada/);
  assert.match(source, /hidden overflow-x-auto[\s\S]*md:block/);
  assert.match(source, /grid gap-3 md:hidden/);
  assert.doesNotMatch(source, /queues\s*\.sort/);
});
