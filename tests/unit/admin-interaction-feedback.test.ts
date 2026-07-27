import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("administração confirma revogação e torna erros de carregamento recuperáveis", async () => {
  const [agents, users, queues] = await Promise.all([
    readFile("frontend/components/Admin/AgentsManagement.tsx", "utf8"),
    readFile("frontend/components/Admin/UserManagement.tsx", "utf8"),
    readFile("frontend/components/Admin/TicketTypeManagement.tsx", "utf8"),
  ]);

  assert.doesNotMatch(agents, /window\.confirm/);
  assert.match(agents, /title="Revogar agente"/);
  assert.match(agents, /Confirmar revogação/);
  assert.match(users, /setLoadError/);
  assert.match(queues, /setLoadError/);
  assert.match(users, /Tentar novamente/);
  assert.match(queues, /Tentar novamente/);
});
