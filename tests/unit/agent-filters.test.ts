import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("monitoramento de agentes filtra instalações no servidor e no tenant atual", async () => {
  const [repository, route, view] = await Promise.all([
    readFile("lib/agent-cloud/agent-repository.ts", "utf8"),
    readFile("app/api/admin/agents/route.ts", "utf8"),
    readFile("frontend/components/Admin/AgentsManagement.tsx", "utf8"),
  ]);

  assert.match(repository, /ai\.organization_id = \$1/);
  assert.match(repository, /installation_key ILIKE/);
  assert.match(repository, /options\.status === "attention"/);
  assert.match(repository, /ORDER BY latest\.received_at DESC/);
  assert.match(repository, /CASE WHEN latest\.status IN \('failed', 'rejected'\)/);
  assert.match(route, /searchParams\.get\("status"\)/);
  assert.match(view, /Buscar por nome ou instalação/);
  assert.match(view, /Nenhum agente encontrado/);
});
