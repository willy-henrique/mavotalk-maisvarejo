import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { granularidadeParaJanela } from "../../lib/metrics/timeseries";

test("janela curta agrupa por hora e janela longa por dia", () => {
  const doisDias = 2 * 24 * 60 * 60 * 1000;
  assert.equal(granularidadeParaJanela(doisDias), "hour");
  assert.equal(granularidadeParaJanela(doisDias + 1), "day");
});

test("a serie agrupa no fuso e devolve o balde como instante absoluto", async () => {
  const fonte = await readFile("lib/metrics/timeseries.ts", "utf8");
  assert.match(fonte, /date_trunc/);
  assert.match(fonte, /created_at AT TIME ZONE \$4/);
  assert.match(fonte, /instante_local AT TIME ZONE \$4/);
});

test("a janela semiaberta inclui o balde que contem o ultimo instante", async () => {
  const fonte = await readFile("lib/metrics/timeseries.ts", "utf8");
  assert.match(fonte, /\$3::timestamptz - interval '1 microsecond'/);
  assert.doesNotMatch(fonte, /\$3::timestamptz[^\n]*- interval '1 (hour|day)'/);
});

test("a granularidade usa somente um mapa fechado de SQL", async () => {
  const fonte = await readFile("lib/metrics/timeseries.ts", "utf8");
  assert.match(fonte, /SQL_POR_GRANULARIDADE/);
  assert.match(fonte, /hour:\s*montarSql\("hour", "1 hour"\)/);
  assert.match(fonte, /day:\s*montarSql\("day", "1 day"\)/);
  assert.doesNotMatch(fonte, /searchParams/);
});

test("tickets e mensagens respeitam fila e atendente", async () => {
  const fonte = await readFile("lib/metrics/timeseries.ts", "utf8");
  assert.match(fonte, /FROM tickets[\s\S]*\$5::text IS NULL OR queue_id = \$5/);
  assert.match(fonte, /FROM tickets[\s\S]*\$6::text IS NULL OR assignee_id = \$6/);
  assert.match(fonte, /FROM messages[\s\S]*EXISTS\s*\([\s\S]*FROM tickets ticket_filtro/);
  assert.match(fonte, /ticket_filtro\.organization_id = \$1/);
  assert.match(fonte, /ticket_filtro\.queue_id = \$5/);
  assert.match(fonte, /ticket_filtro\.assignee_id = \$6/);
});

test("toda consulta da serie filtra organization_id explicitamente", async () => {
  const fonte = await readFile("lib/metrics/timeseries.ts", "utf8");
  const ocorrencias = fonte.match(/organization_id = \$1/g) || [];
  assert.ok(ocorrencias.length >= 3, "tickets, mensagens e ticket correlacionado isolam tenant");
  assert.match(fonte, /queryTenantDatabase/);
});

test("as opcoes trazem somente filas e usuarios ativos da organizacao", async () => {
  const fonte = await readFile("lib/metrics/filters.ts", "utf8");
  const organizacoes = fonte.match(/organization_id = \$1/g) || [];
  const ativos = fonte.match(/is_active = true/g) || [];
  assert.ok(organizacoes.length >= 2, "filas e atendentes precisam filtrar por organização");
  assert.ok(ativos.length >= 2, "filas e atendentes precisam estar ativos");
});

test("as rotas usam guard, organizacao da sessao e envelope", async () => {
  for (const rota of ["timeseries", "filters"]) {
    const fonte = await readFile(`app/api/metrics/v1/${rota}/route.ts`, "utf8");
    assert.match(fonte, /requireMetricsAccess/);
    assert.match(fonte, /session\.organizationId/);
    assert.match(fonte, /getOrganizationTimeZone/);
    assert.match(fonte, /resolvePeriod/);
    assert.match(fonte, /metricsEnvelope/);
    assert.match(fonte, /PeriodError/);
  }
});

test("a rota escolhe granularidade pela duracao e ignora escolha do cliente", async () => {
  const fonte = await readFile("app/api/metrics/v1/timeseries/route.ts", "utf8");
  assert.match(
    fonte,
    /granularidadeParaJanela\(\s*periodo\.to\.getTime\(\) - periodo\.from\.getTime\(\),?\s*\)/,
  );
  assert.doesNotMatch(
    fonte,
    /searchParams\.get\(\s*["'](?:granularity|granularidade)["']\s*\)/,
  );
  assert.match(fonte, /granularity:\s*granularidade/);
});
