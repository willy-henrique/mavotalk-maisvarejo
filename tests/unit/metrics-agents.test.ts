import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("producao inclui todo atendente ativo mesmo sem tickets", async () => {
  const fonte = await readFile("lib/metrics/agents.ts", "utf8");
  assert.match(fonte, /FROM users/i);
  assert.match(fonte, /LEFT JOIN ticket_stats/i);
  assert.match(fonte, /is_active = true/i);
  assert.match(fonte, /role = 'atendente'/i);
});

test("tickets dos atendentes usam organizacao e janela semiaberta", async () => {
  const fonte = await readFile("lib/metrics/agents.ts", "utf8");
  assert.match(fonte, /organization_id = \$1/g);
  assert.match(fonte, /created_at >= \$2/);
  assert.match(fonte, /created_at < \$3/);
  assert.doesNotMatch(fonte, /created_at <= \$3/);
  assert.match(fonte, /queryTenantDatabase/);
});

test("fila e atendente sao filtros opcionais parametrizados", async () => {
  const fonte = await readFile("lib/metrics/agents.ts", "utf8");
  assert.match(fonte, /\$4::text IS NULL OR queue_id = \$4/);
  assert.match(fonte, /\$5::text IS NULL OR assignee_id = \$5/);
});

test("mensagens enviadas pertencem ao autor e a mesma organizacao", async () => {
  const fonte = await readFile("lib/metrics/agents.ts", "utf8");
  assert.match(fonte, /direction = 'outbound'/);
  assert.match(fonte, /author_id/);
  const organizacoes = fonte.match(/organization_id = \$1/g) ?? [];
  assert.ok(organizacoes.length >= 3);
});

test("resultado e ordenado por volume e depois por nome", async () => {
  const fonte = await readFile("lib/metrics/agents.ts", "utf8");
  assert.match(fonte, /ORDER BY tickets DESC, u\.name/i);
});

test("rota de agentes usa guard, sessao, periodo e envelope", async () => {
  const fonte = await readFile("app/api/metrics/v1/agents/route.ts", "utf8");
  assert.match(fonte, /requireMetricsAccess/);
  assert.match(fonte, /session\.organizationId/);
  assert.match(fonte, /resolvePeriod/);
  assert.match(fonte, /PeriodError/);
  assert.match(fonte, /metricsEnvelope/);
});
