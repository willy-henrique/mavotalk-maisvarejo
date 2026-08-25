import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("a consulta do Agora filtra organization_id explicitamente", async () => {
  const fonte = await readFile("lib/metrics/live.ts", "utf8");
  assert.match(fonte, /organization_id = \$1/);
  assert.match(fonte, /queryTenantDatabase/);
});

test("o Agora usa os quatro estados reais do enum", async () => {
  const fonte = await readFile("lib/metrics/live.ts", "utf8");
  assert.match(fonte, /'aguardando'/);
  assert.match(fonte, /'em_atendimento'/);
  assert.match(fonte, /'pendente_cliente'/);
  assert.match(fonte, /'encerrado'/);
});

test("a rota do Agora nunca e cacheada", async () => {
  const fonte = await readFile("app/api/metrics/v1/live/route.ts", "utf8");
  assert.match(fonte, /force-dynamic/);
  assert.doesNotMatch(fonte, /revalidate\s*=\s*\d/);
});

test("a rota do Agora usa a organizacao da sessao", async () => {
  const fonte = await readFile("app/api/metrics/v1/live/route.ts", "utf8");
  assert.match(fonte, /session\.organizationId/);
  assert.doesNotMatch(fonte, /searchParams\.get\(["']organization/);
});

test("SLA em risco exclui prazo vencido e ticket ja estourado", async () => {
  const fonte = await readFile("lib/metrics/live.ts", "utf8");
  assert.match(fonte, /first_response_due_at > now\(\)/);
  assert.match(fonte, /first_response_due_at <= now\(\) \+ interval '5 minutes'/);
  assert.match(fonte, /first_response_sla_breached_at IS NULL/);
});
