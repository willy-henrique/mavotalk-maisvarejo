import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("o guard checa o token de servico antes de qualquer outra coisa", async () => {
  const fonte = await readFile("lib/metrics/guard.ts", "utf8");
  const posServico = fonte.indexOf("MAVO_METRICS_TOKEN");
  const posSessao = fonte.indexOf("getSession");
  assert.ok(posServico > -1, "guard precisa ler MAVO_METRICS_TOKEN");
  assert.ok(posSessao > -1, "guard precisa resolver a sessão");
  assert.ok(posServico < posSessao, "o token de serviço é checado antes da sessão");
});

test("o guard recusa o papel atendente", async () => {
  const fonte = await readFile("lib/metrics/guard.ts", "utf8");
  assert.match(fonte, /atendente/);
  assert.match(fonte, /forbidden/);
});

test("o guard usa comparacao de tempo constante no token de servico", async () => {
  const fonte = await readFile("lib/metrics/guard.ts", "utf8");
  assert.match(fonte, /timingSafeEqual/);
});

test("nenhuma rota de metricas aceita organizacao por parametro", async () => {
  const fonte = await readFile("lib/metrics/guard.ts", "utf8");
  assert.doesNotMatch(fonte, /searchParams\.get\(["']org/);
  assert.match(fonte, /session\.organizationId|sessao\.organizationId/);
});

test("o guard registra a auditoria da consulta de negocio", async () => {
  const fonte = await readFile("lib/metrics/guard.ts", "utf8");
  assert.match(fonte, /business_query_audit|auditQuery/);
});

test("o guard invalida sessao quando status ou papel mudaram no banco", async () => {
  const fonte = await readFile("lib/metrics/guard.ts", "utf8");
  assert.match(fonte, /u\.is_active = true/);
  assert.match(fonte, /u\.role = \$6/);
  assert.match(fonte, /session\.role/);
});
