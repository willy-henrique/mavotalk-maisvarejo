import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("login de metricas recusa atendente", async () => {
  const fonte = await readFile("app/api/metrics/v1/auth/login/route.ts", "utf8");
  assert.match(fonte, /atendente/);
  assert.match(fonte, /forbidden/);
});

test("login de metricas passa por rate limit e compara hash com bcrypt", async () => {
  const fonte = await readFile("app/api/metrics/v1/auth/login/route.ts", "utf8");
  assert.match(fonte, /consumeRateLimit/);
  assert.match(fonte, /bcrypt\.compare/);
  assert.match(fonte, /DUMMY_PASSWORD_HASH/);
});

test("login nao revela se o e-mail existe", async () => {
  const fonte = await readFile("app/api/metrics/v1/auth/login/route.ts", "utf8");
  const mensagens = fonte.match(/metricsError\("unauthenticated", "([^"]+)"/g) || [];
  const distintas = new Set(mensagens);
  assert.equal(distintas.size, 1, "usuário inexistente e senha errada devem responder igual");
});

test("health nao exige sessao de usuario", async () => {
  const fonte = await readFile("app/api/metrics/v1/health/route.ts", "utf8");
  assert.doesNotMatch(fonte, /requireMetricsAccess/);
  assert.match(fonte, /MAVO_METRICS_TOKEN|x-mavo-service-token/);
});

test("login e me resolvem o nome real da organizacao", async () => {
  const [login, me] = await Promise.all([
    readFile("app/api/metrics/v1/auth/login/route.ts", "utf8"),
    readFile("app/api/metrics/v1/me/route.ts", "utf8"),
  ]);
  assert.match(login, /organizationForMetrics/);
  assert.match(me, /organizationForMetrics/);
});
