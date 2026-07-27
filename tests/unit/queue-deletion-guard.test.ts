import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("exclusão de fila falha de forma segura quando há atendimento vinculado", async () => {
  const [repository, route, view] = await Promise.all([
    readFile("lib/supabase-repo.ts", "utf8"),
    readFile("app/api/queues/[id]/route.ts", "utf8"),
    readFile("frontend/components/Admin/TicketTypeManagement.tsx", "utf8"),
  ]);

  assert.match(repository, /export async function deleteQueue/);
  assert.match(repository, /from\("conversations"\)/);
  assert.match(repository, /from\("tickets"\)/);
  assert.match(repository, /return "in_use"/);
  assert.match(route, /"admin_types", "delete"/);
  assert.match(route, /status: 409/);
  assert.match(view, /Excluir fila/);
  assert.match(view, /apiDelete\(`\/api\/queues/);
});
