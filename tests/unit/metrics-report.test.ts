import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("relatorio usa tenant, janela semiaberta e filtros parametrizados", async () => {
  const fonte = await readFile("lib/metrics/tickets-report.ts", "utf8");
  assert.match(fonte, /queryTenantDatabase/);
  assert.match(fonte, /organization_id = \$1/g);
  assert.match(fonte, /created_at >= \$2/);
  assert.match(fonte, /created_at < \$3/);
  assert.match(fonte, /\$4::text IS NULL OR ticket\.queue_id = \$4/);
  assert.match(fonte, /\$5::text IS NULL OR ticket\.assignee_id = \$5/);
});

test("paginacao usa cursor composto e nunca OFFSET", async () => {
  const fonte = await readFile("lib/metrics/tickets-report.ts", "utf8");
  assert.match(fonte, /ticket\.created_at, ticket\.id/);
  assert.match(fonte, /ORDER BY ticket\.created_at DESC, ticket\.id DESC/);
  assert.match(fonte, /LIMIT \$8/);
  assert.doesNotMatch(fonte, /\bOFFSET\b/i);
});

test("relatorio tem tetos de pagina e exportacao", async () => {
  const fonte = await readFile("lib/metrics/tickets-report.ts", "utf8");
  assert.match(fonte, /MAX_REPORT_ROWS = 5_000/);
  assert.match(fonte, /MAX_PAGE_SIZE = 200/);
});

test("cursor e validado e nunca interpolado no SQL", async () => {
  const fonte = await readFile("lib/metrics/tickets-report.ts", "utf8");
  assert.match(fonte, /base64url/);
  assert.match(fonte, /ReportError/);
  assert.match(fonte, /\$6::timestamptz/);
  assert.match(fonte, /\$7::text/);
  assert.doesNotMatch(fonte, /\$\{[^}]*cursor/i);
});

test("linha traz contexto suficiente para tela e CSV", async () => {
  const fonte = await readFile("lib/metrics/tickets-report.ts", "utf8");
  for (const campo of [
    "contatoNome",
    "contatoTelefone",
    "fila",
    "atendente",
    "status",
    "tmeSegundos",
    "tmaSegundos",
    "slaEstourado",
    "csat",
  ]) {
    assert.match(fonte, new RegExp(campo));
  }
});

test("rota valida limite e traduz cursor invalido sem erro interno", async () => {
  const fonte = await readFile("app/api/metrics/v1/reports/tickets/route.ts", "utf8");
  assert.match(fonte, /requireMetricsAccess/);
  assert.match(fonte, /session\.organizationId/);
  assert.match(fonte, /ReportError/);
  assert.match(fonte, /invalid_request/);
  assert.match(fonte, /metricsEnvelope/);
});
