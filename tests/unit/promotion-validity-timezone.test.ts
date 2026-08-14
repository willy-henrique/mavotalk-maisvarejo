import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  describeZonedDeadline,
  formatZonedDate,
  formatZonedDateTime,
  formatZonedTime,
  resolveTimeZone,
  zonedDayDistance,
  zonedParts,
} from "../../lib/timezone";
import { getGreeting } from "../../lib/quick-reply-service";
import { isInsideTimeRange } from "../../lib/utils";
import {
  formatZonedDateTime as formatZonedDateTimeInPanel,
  fromZonedInputDateTime,
  isZonedTimeOfDay,
  toZonedInputDateTime,
  toZonedInputTime,
  withZonedTimeOfDay,
  zonedEndOfDay,
} from "../../frontend/services/timezone";

const SAO_PAULO = "America/Sao_Paulo";
/** 14/08/2026 às 22:00 em São Paulo. O servidor de produção roda em UTC. */
const EXPIRES_AT = new Date("2026-08-15T01:00:00.000Z");
const NOW = new Date("2026-08-14T11:00:00.000Z");

test("validade da promoção sai no relógio da loja, não no do servidor", () => {
  assert.equal(formatZonedDateTime(EXPIRES_AT, SAO_PAULO), "14/08/2026 às 22:00");
  assert.equal(describeZonedDeadline(EXPIRES_AT, SAO_PAULO, NOW), "hoje às 22:00");
  // O relógio do servidor jogava a validade para 15/08, 01:00 — a data que a
  // operação reportou como errada na conversa do cliente.
  assert.equal(formatZonedDateTime(EXPIRES_AT, "UTC"), "15/08/2026 às 01:00");
});

test("prazo de hoje, de amanhã e de outra data ganham textos distintos", () => {
  const tomorrow = new Date("2026-08-16T01:00:00.000Z");
  const later = new Date("2026-08-21T23:00:00.000Z");
  assert.equal(describeZonedDeadline(EXPIRES_AT, SAO_PAULO, NOW), "hoje às 22:00");
  assert.equal(describeZonedDeadline(tomorrow, SAO_PAULO, NOW), "amanhã às 22:00");
  assert.equal(describeZonedDeadline(later, SAO_PAULO, NOW), "21/08/2026 às 20:00");
});

test("partes zoneadas alimentam expediente e dias de calendário", () => {
  const parts = zonedParts(EXPIRES_AT, SAO_PAULO);
  assert.equal(parts.dateKey, "2026-08-14");
  assert.equal(parts.weekday, 5);
  assert.equal(parts.minutesOfDay, 22 * 60);
  assert.equal(formatZonedDate(EXPIRES_AT, SAO_PAULO), "14/08/2026");
  assert.equal(formatZonedTime(EXPIRES_AT, SAO_PAULO), "22:00");
  assert.equal(zonedDayDistance(NOW, EXPIRES_AT, SAO_PAULO), 0);
  // Meia-noite não pode virar "24:00": é o que h12/h24 devolvem em en-US.
  assert.equal(formatZonedTime(new Date("2026-08-14T03:00:00.000Z"), SAO_PAULO), "00:00");
});

test("fuso inválido cai no padrão em vez de derrubar a resposta do bot", () => {
  assert.equal(resolveTimeZone("Marte/Olympus"), SAO_PAULO);
  assert.equal(resolveTimeZone(""), SAO_PAULO);
  assert.equal(resolveTimeZone(null), SAO_PAULO);
  assert.equal(resolveTimeZone("America/Manaus"), "America/Manaus");
});

test("expediente e saudação usam os minutos do fuso da loja", () => {
  assert.equal(isInsideTimeRange(zonedParts(EXPIRES_AT, SAO_PAULO).minutesOfDay, "07:00", "21:00"), false);
  assert.equal(isInsideTimeRange(zonedParts(EXPIRES_AT, SAO_PAULO).minutesOfDay, "07:00", "23:00"), true);
  // 11:30 em São Paulo, 14:30 em UTC: o servidor dizia "Boa tarde" de manhã.
  const morning = new Date("2026-08-14T14:30:00.000Z");
  assert.equal(getGreeting(morning, SAO_PAULO), "Bom dia");
  assert.equal(getGreeting(morning, "UTC"), "Boa tarde");
});

test("painel grava e relê o período no fuso da loja, sem deslocar o horário", () => {
  const iso = fromZonedInputDateTime("2026-08-14T22:00", SAO_PAULO, "");
  assert.equal(iso, EXPIRES_AT.toISOString());
  assert.equal(toZonedInputDateTime(iso, SAO_PAULO), "2026-08-14T22:00");
  assert.equal(toZonedInputTime(iso, SAO_PAULO), "22:00");
  assert.equal(isZonedTimeOfDay(iso, SAO_PAULO, 22, 0), true);
  assert.equal(withZonedTimeOfDay(iso, SAO_PAULO, 18, 30), "2026-08-14T21:30:00.000Z");
  // Campo vazio não pode virar RangeError nem apagar o valor atual.
  assert.equal(fromZonedInputDateTime("", SAO_PAULO, iso), iso);
});

test("até o fim do dia expira no último instante do dia da loja", () => {
  const endOfDay = zonedEndOfDay(EXPIRES_AT.toISOString(), SAO_PAULO);
  assert.equal(endOfDay, "2026-08-15T02:59:59.999Z");
  assert.equal(formatZonedDateTimeInPanel(endOfDay, SAO_PAULO), "14/08/2026 às 23:59");
  // 23:59:00 tirava a promoção do ar um minuto antes da virada.
  assert.ok(new Date(endOfDay).getTime() > new Date(withZonedTimeOfDay(endOfDay, SAO_PAULO, 23, 59)).getTime());
});

test("fusos com horário de verão convertem sem pular a virada", () => {
  const newYork = "America/New_York";
  const beforeChange = fromZonedInputDateTime("2026-03-08T01:30", newYork, "");
  const afterChange = fromZonedInputDateTime("2026-03-08T03:30", newYork, "");
  assert.equal(toZonedInputDateTime(beforeChange, newYork), "2026-03-08T01:30");
  assert.equal(toZonedInputDateTime(afterChange, newYork), "2026-03-08T03:30");
  assert.equal(new Date(afterChange).getTime() - new Date(beforeChange).getTime(), 60 * 60 * 1000);
});

test("painel e runtime do bot descrevem o mesmo horário", () => {
  for (const zone of [SAO_PAULO, "America/Manaus", "UTC", "Europe/Lisbon"]) {
    assert.equal(formatZonedDateTimeInPanel(EXPIRES_AT.toISOString(), zone), formatZonedDateTime(EXPIRES_AT, zone));
  }
});

test("o runtime das ofertas resolve o fuso da loja antes de montar a legenda", async () => {
  const [runtime, route, manager, drawer] = await Promise.all([
    readFile("lib/queue-automation-runtime.ts", "utf8"),
    readFile("app/api/queues/[id]/configuration/route.ts", "utf8"),
    readFile("frontend/components/Admin/QueuePromotionManager.tsx", "utf8"),
    readFile("frontend/components/Admin/QueueAutomationDrawer.tsx", "utf8"),
  ]);
  assert.match(runtime, /getOrganizationTimeZone\(organizationId, queueId\)/);
  assert.match(runtime, /Válida até \$\{describeZonedDeadline\(new Date\(promotion\.expiresAt\), timeZone, now\)\}/);
  assert.doesNotMatch(runtime, /DateTimeFormat\("pt-BR"/, "a legenda não pode ser formatada no fuso do servidor");
  assert.match(route, /timeZone = await getOrganizationTimeZone\(result\.session\.organizationId, id\)/);
  assert.doesNotMatch(manager, /toLocaleString\('pt-BR'\)/, "o editor não pode exibir o período no fuso do dispositivo");
  assert.match(drawer, /<QueuePromotionManager[^>]*timeZone=\{data\?\.timeZone\}/);
});
