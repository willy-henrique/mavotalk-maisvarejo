import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("metricas por fila usam tenant e janela semiaberta", async () => {
  const fonte = await readFile("lib/metrics/queues.ts", "utf8");
  assert.match(fonte, /queryTenantDatabase/);
  assert.match(fonte, /organization_id = \$1/g);
  assert.match(fonte, /created_at >= \$2/);
  assert.match(fonte, /created_at < \$3/);
  assert.doesNotMatch(fonte, /created_at <= \$3/);
});

test("fila e atendente sao filtros opcionais parametrizados", async () => {
  const fonte = await readFile("lib/metrics/queues.ts", "utf8");
  assert.match(fonte, /\$4::text IS NULL OR queue_id = \$4/);
  assert.match(fonte, /\$5::text IS NULL OR assignee_id = \$5/);
});

test("tickets sem fila ganham linha explicita em vez de sumir", async () => {
  const fonte = await readFile("lib/metrics/queues.ts", "utf8");
  assert.match(fonte, /queue_id IS NULL/);
  assert.match(fonte, /sem-fila/);
  assert.match(fonte, /Sem fila/);
});

test("fila inativa com historico continua no resultado", async () => {
  const fonte = await readFile("lib/metrics/queues.ts", "utf8");
  assert.match(fonte, /is_active = true/);
  assert.match(fonte, /EXISTS[\s\S]*ticket_stats/i);
});

test("SLA e TME usam os campos canonicos do ticket", async () => {
  const fonte = await readFile("lib/metrics/queues.ts", "utf8");
  assert.match(fonte, /first_response_sla_breached_at/);
  assert.match(fonte, /first_response_at - created_at/);
});

test("rota de filas usa guard, sessao, periodo e envelope", async () => {
  const fonte = await readFile("app/api/metrics/v1/queues/route.ts", "utf8");
  assert.match(fonte, /requireMetricsAccess/);
  assert.match(fonte, /session\.organizationId/);
  assert.match(fonte, /resolvePeriod/);
  assert.match(fonte, /PeriodError/);
  assert.match(fonte, /metricsEnvelope/);
});
