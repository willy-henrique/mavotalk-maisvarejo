import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("desempenho do bot usa organizacao e janela semiaberta", async () => {
  const fonte = await readFile("lib/metrics/bot.ts", "utf8");
  assert.match(fonte, /queryTenantDatabase/);
  assert.match(fonte, /organization_id = \$1/g);
  assert.match(fonte, /created_at >= \$2/);
  assert.match(fonte, /created_at < \$3/);
  assert.doesNotMatch(fonte, /created_at <= \$3/);
});

test("resolucao sem humano segue a formula congelada do contrato", async () => {
  const fonte = await readFile("lib/metrics/bot.ts", "utf8");
  assert.match(fonte, /status = 'encerrado'/);
  assert.match(fonte, /triage_completed = false/);
  assert.match(fonte, /assignee_id IS NULL/);
});

test("transferencia conta atendimento realmente assumido por uma pessoa", async () => {
  const fonte = await readFile("lib/metrics/bot.ts", "utf8");
  assert.match(fonte, /assignee_id IS NOT NULL/);
  assert.match(fonte, /ticket\.organization_id = \$1/);
});

test("opcoes invalidas somam tentativas sem permitir agregado negativo", async () => {
  const fonte = await readFile("lib/metrics/bot.ts", "utf8");
  assert.match(fonte, /menu_attempts/);
  assert.match(fonte, /GREATEST\([^)]*menu_attempts, 0\)/i);
});

test("taxa de transferencia trata periodo sem conversas sem NaN", async () => {
  const fonte = await readFile("lib/metrics/bot.ts", "utf8");
  assert.match(fonte, /conversas > 0/);
  assert.doesNotMatch(fonte, /Infinity/);
});

test("rota do bot usa guard, organizacao da sessao e envelope", async () => {
  const fonte = await readFile("app/api/metrics/v1/bot/route.ts", "utf8");
  assert.match(fonte, /requireMetricsAccess/);
  assert.match(fonte, /session\.organizationId/);
  assert.match(fonte, /resolvePeriod/);
  assert.match(fonte, /PeriodError/);
  assert.match(fonte, /metricsEnvelope/);
});
