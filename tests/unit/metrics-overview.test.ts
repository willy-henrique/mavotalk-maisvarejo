import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("a consulta do periodo usa janela semiaberta", async () => {
  const fonte = await readFile("lib/metrics/overview.ts", "utf8");
  assert.match(fonte, /created_at >= \$2/);
  assert.match(fonte, /created_at < \$3/);
  assert.doesNotMatch(fonte, /created_at <= \$3/);
});

test("os filtros de fila e atendente sao opcionais e parametrizados", async () => {
  const fonte = await readFile("lib/metrics/overview.ts", "utf8");
  assert.match(fonte, /\$4::text IS NULL OR queue_id = \$4/);
  assert.match(fonte, /\$5::text IS NULL OR assignee_id = \$5/);
});

test("a rota do overview traduz PeriodError no codigo certo", async () => {
  const fonte = await readFile("app/api/metrics/v1/overview/route.ts", "utf8");
  assert.match(fonte, /PeriodError/);
  assert.match(fonte, /erro\.code/);
});

test("a rota do overview devolve o envelope com comparacao", async () => {
  const fonte = await readFile("app/api/metrics/v1/overview/route.ts", "utf8");
  assert.match(fonte, /metricsEnvelope/);
  assert.match(fonte, /comparison/);
});

test("mensagens respeitam filtros ativos pelo ticket da mesma organizacao", async () => {
  const fonte = await readFile("lib/metrics/overview.ts", "utf8");
  assert.match(fonte, /FROM messages[\s\S]*EXISTS\s*\([\s\S]*FROM tickets/);
  assert.match(fonte, /ticket_filtro\.organization_id = \$1/);
  assert.match(fonte, /ticket_filtro\.queue_id = \$4/);
  assert.match(fonte, /ticket_filtro\.assignee_id = \$5/);
});
