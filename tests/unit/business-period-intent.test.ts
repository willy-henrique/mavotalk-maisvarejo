import test from "node:test";
import assert from "node:assert/strict";
import {
  businessPeriodFromIsoRange,
  daysInPeriod,
  parseBusinessPeriod,
  previousComparablePeriod,
} from "../../lib/business-analytics/business-period-parser";
import {
  parseBusinessIntent,
  requestedLimit,
} from "../../lib/business-analytics/business-query-intents";

const now = new Date("2026-07-23T15:00:00.000Z");

test("interpreta períodos conhecidos no timezone do negócio", () => {
  assert.deepEqual(
    parseBusinessPeriod("hoje", { now }),
    {
      from: "2026-07-23",
      to: "2026-07-23",
      label: "hoje",
      timezone: "America/Sao_Paulo",
    },
  );
  assert.deepEqual(
    parseBusinessPeriod("últimos 7 dias", { now }),
    {
      from: "2026-07-17",
      to: "2026-07-23",
      label: "últimos 7 dias",
      timezone: "America/Sao_Paulo",
    },
  );
  const explicit = parseBusinessPeriod("01/07/2026 até 22/07/2026", { now });
  assert.equal(explicit.from, "2026-07-01");
  assert.equal(explicit.to, "2026-07-22");
  assert.equal(daysInPeriod(explicit), 22);
});

test("calcula período anterior com o mesmo número de dias", () => {
  const current = parseBusinessPeriod("últimos 7 dias", { now });
  const previous = previousComparablePeriod(current);
  assert.equal(previous.from, "2026-07-10");
  assert.equal(previous.to, "2026-07-16");
  assert.equal(daysInPeriod(previous), 7);
});

test("recusa intervalos invertidos ou maiores que um ano", () => {
  assert.throws(
    () => parseBusinessPeriod("22/07/2026 a 01/07/2026", { now }),
    /inválido/,
  );
  assert.throws(
    () => parseBusinessPeriod("01/01/2025 a 23/07/2026", { now }),
    /máximo/,
  );
  assert.throws(
    () =>
      businessPeriodFromIsoRange({
        from: "2026-02-31",
        to: "2026-03-01",
      }),
    /inválido/,
  );
  assert.throws(
    () =>
      businessPeriodFromIsoRange({
        from: "2025-01-01",
        to: "2026-07-23",
      }),
    /máximo/,
  );
});

test("roteia intenções determinísticas e não confunde período com limite", () => {
  assert.equal(parseBusinessIntent("Quanto vendemos hoje?"), "sales_total");
  assert.equal(
    parseBusinessIntent("Qual foi o produto mais vendido deste mês?"),
    "top_selling_products",
  );
  assert.equal(
    parseBusinessIntent("Em qual dia da semana vendemos mais?"),
    "sales_by_weekday",
  );
  assert.equal(parseBusinessIntent("7"), "inventory_entries");
  assert.equal(
    requestedLimit("produtos mais vendidos nos últimos 7 dias", 5),
    5,
  );
  assert.equal(requestedLimit("mostre os 10 produtos mais vendidos", 5), 10);
  assert.equal(requestedLimit("top 99 produtos", 5), 20);
});
