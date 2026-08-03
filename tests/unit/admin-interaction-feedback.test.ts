import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("administração confirma revogação, mantém ações acessíveis e torna erros recuperáveis", async () => {
  const [agents, users, queues, styles, audit] = await Promise.all([
    readFile("frontend/components/Admin/AgentsManagement.tsx", "utf8"),
    readFile("frontend/components/Admin/UserManagement.tsx", "utf8"),
    readFile("frontend/components/Admin/TicketTypeManagement.tsx", "utf8"),
    readFile("frontend/index.css", "utf8"),
    readFile("frontend/components/BusinessAudit.tsx", "utf8"),
  ]);

  assert.doesNotMatch(agents, /window\.confirm/);
  assert.match(agents, /title="Revogar agente"/);
  assert.match(agents, /Confirmar revogação/);
  assert.match(users, /setLoadError/);
  assert.match(queues, /setLoadError/);
  assert.match(users, /Tentar novamente/);
  assert.match(queues, /Tentar novamente/);
  assert.match(queues, /requestRef/);
  assert.match(queues, /Dados básicos da fila atualizados/);
  assert.match(queues, /Fila criada\. Agora configure a automação/);
  assert.match(queues, /role="status"/);
  assert.match(queues, /group-focus-within:opacity-100/);
  assert.match(queues, /aria-label=\{`Editar dados básicos da fila \$\{q\.name\}`\}/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(agents, /closeEvents/);
  assert.match(audit, /detailRequestRef/);
  assert.match(audit, /closeDetail/);
});
