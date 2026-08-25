import test from "node:test";
import assert from "node:assert/strict";
import { resolvePeriod, PeriodError, MAX_PERIOD_DAYS } from "../../lib/metrics/period";

const FUSO = "America/Sao_Paulo";

test("hoje comeca a meia-noite do fuso da organizacao, nao em UTC", () => {
  // 24/08/2026 02:00 UTC = 23/08/2026 23:00 em Sao Paulo
  const agora = new Date("2026-08-24T02:00:00Z");
  const p = resolvePeriod({ name: "hoje", timezone: FUSO, now: agora });
  assert.equal(p.from.toISOString(), "2026-08-23T03:00:00.000Z");
  assert.equal(p.to.toISOString(), "2026-08-24T03:00:00.000Z");
});

test("a janela de comparacao tem a mesma duracao e termina onde a atual comeca", () => {
  const agora = new Date("2026-08-24T15:00:00Z");
  const p = resolvePeriod({ name: "7d", timezone: FUSO, now: agora });
  const duracaoAtual = p.to.getTime() - p.from.getTime();
  const duracaoAnterior = p.comparison.to.getTime() - p.comparison.from.getTime();
  assert.equal(duracaoAnterior, duracaoAtual);
  assert.equal(p.comparison.to.getTime(), p.from.getTime());
});

test("periodo personalizado acima de 90 dias e recusado", () => {
  assert.throws(
    () =>
      resolvePeriod({
        name: "custom",
        from: "2026-01-01T00:00:00-03:00",
        to: "2026-06-01T00:00:00-03:00",
        timezone: FUSO,
      }),
    (erro: unknown) => erro instanceof PeriodError && erro.code === "period_too_long",
  );
});

test("periodo personalizado invertido e recusado", () => {
  assert.throws(
    () =>
      resolvePeriod({
        name: "custom",
        from: "2026-06-01T00:00:00-03:00",
        to: "2026-01-01T00:00:00-03:00",
        timezone: FUSO,
      }),
    (erro: unknown) => erro instanceof PeriodError && erro.code === "invalid_period",
  );
});

test("datas civis personalizadas comecam a meia-noite do fuso da organizacao", () => {
  const p = resolvePeriod({
    name: "custom",
    from: "2026-08-01",
    to: "2026-08-02",
    timezone: FUSO,
  });

  assert.equal(p.from.toISOString(), "2026-08-01T03:00:00.000Z");
  assert.equal(p.to.toISOString(), "2026-08-02T03:00:00.000Z");
});

test("90 dias civis personalizados continuam validos em horario de verao", () => {
  const p = resolvePeriod({
    name: "custom",
    from: "2026-08-05",
    to: "2026-11-03",
    timezone: "America/New_York",
  });

  assert.equal(p.from.toISOString(), "2026-08-05T04:00:00.000Z");
  assert.equal(p.to.toISOString(), "2026-11-03T05:00:00.000Z");
});

test("nome desconhecido e recusado", () => {
  assert.throws(
    () => resolvePeriod({ name: "trimestre", timezone: FUSO }),
    (erro: unknown) => erro instanceof PeriodError && erro.code === "invalid_period",
  );
});

test("o teto e de 90 dias", () => {
  assert.equal(MAX_PERIOD_DAYS, 90);
});

test("dias nomeados respeitam a virada do horario de verao", () => {
  const p = resolvePeriod({
    name: "ontem",
    timezone: "America/New_York",
    now: new Date("2026-03-09T16:00:00Z"),
  });

  assert.equal(p.from.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(p.to.toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal(p.to.getTime() - p.from.getTime(), 23 * 60 * 60 * 1000);
});

test("90d continua valido quando inclui um dia de 25 horas", () => {
  const p = resolvePeriod({
    name: "90d",
    timezone: "America/New_York",
    now: new Date("2026-11-02T17:00:00Z"),
  });

  assert.equal(p.from.toISOString(), "2026-08-05T04:00:00.000Z");
  assert.equal(p.to.toISOString(), "2026-11-03T05:00:00.000Z");
});

test("fuso desconhecido e recusado como periodo invalido", () => {
  assert.throws(
    () => resolvePeriod({ name: "hoje", timezone: "Fuso/Inexistente" }),
    (erro: unknown) => erro instanceof PeriodError && erro.code === "invalid_period",
  );
});
