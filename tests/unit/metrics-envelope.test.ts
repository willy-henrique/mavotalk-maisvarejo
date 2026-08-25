import test from "node:test";
import assert from "node:assert/strict";
import { metricsEnvelope, metricsError } from "../../lib/metrics/envelope";

test("envelope carrega data e meta juntos", async () => {
  const resposta = metricsEnvelope(
    { tickets: 32 },
    {
      period: { from: "2026-08-24T00:00:00-03:00", to: "2026-08-25T00:00:00-03:00" },
      comparison: null,
      timezone: "America/Sao_Paulo",
      generatedAt: "2026-08-24T14:02:11-03:00",
      filters: { queueId: null, assigneeId: null },
    },
  );
  const corpo = await resposta.json();
  assert.equal(resposta.status, 200);
  assert.equal(corpo.data.tickets, 32);
  assert.equal(corpo.meta.timezone, "America/Sao_Paulo");
});

test("cada código de erro tem o status HTTP certo", async () => {
  assert.equal(metricsError("unauthenticated", "x").status, 401);
  assert.equal(metricsError("forbidden", "x").status, 403);
  assert.equal(metricsError("invalid_period", "x").status, 400);
  assert.equal(metricsError("period_too_long", "x").status, 400);
  assert.equal(metricsError("rate_limited", "x").status, 429);
  assert.equal(metricsError("internal", "x").status, 500);
});

test("erro nunca vaza detalhe interno no corpo", async () => {
  const corpo = await metricsError("internal", "Falha ao consultar").json();
  assert.deepEqual(Object.keys(corpo), ["error"]);
  assert.deepEqual(Object.keys(corpo.error).sort(), ["code", "message"]);
});
