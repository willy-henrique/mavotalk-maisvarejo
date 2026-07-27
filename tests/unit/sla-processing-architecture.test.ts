import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(path, "utf8");

test("SLA de primeira resposta é agendado com contexto de tenant", async () => {
  const [queue, repository] = await Promise.all([
    read("lib/queues.ts"),
    read("lib/supabase-repo.ts"),
  ]);
  assert.match(queue, /organizationId: string/);
  assert.match(queue, /\{ organizationId, conversationId, dueAt:/);
  assert.match(repository, /enqueueSlaCheck\(organizationId, conversationId, dueAt\)/);
});

test("worker de SLA revalida prazo, tenant e idempotência antes de auditar", async () => {
  const [worker, processor, migration] = await Promise.all([
    read("worker.mjs"),
    read("lib/sla-worker.mjs"),
    read("supabase/migrations/202607270001_ticket_sla_breach.sql"),
  ]);
  assert.match(worker, /processFirstResponseSlaCheck/);
  assert.match(processor, /set_config\('app\.organization_id'/);
  assert.match(processor, /ticket\.first_response_at IS NULL/);
  assert.match(processor, /ticket\.first_response_due_at <= now\(\)/);
  assert.match(processor, /ticket\.first_response_sla_breached_at IS NULL/);
  assert.match(processor, /sla_first_response_breached/);
  assert.match(migration, /first_response_sla_breached_at/);
});
