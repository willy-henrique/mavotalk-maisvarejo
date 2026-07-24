import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateSalesByWeekday,
  averagePerCalendarDay,
} from "../../lib/business-analytics/business-calculations";
import {
  formatBusinessSummary,
  formatCurrency,
  formatSalesByDay,
} from "../../lib/business-analytics/business-response-formatter";

const period = {
  from: "2026-07-01",
  to: "2026-07-22",
  label: "julho/2026",
  timezone: "America/Sao_Paulo",
};

test("calcula média diária pelos dias corridos do período", () => {
  assert.equal(averagePerCalendarDay(184_320.5, period), 8_378.204545454546);
});

test("agrega dias pelo dia da semana e ordena pelo total", () => {
  const result = aggregateSalesByWeekday([
    {
      date: "2026-07-20",
      netTotal: 100,
      grossTotal: 100,
      salesCount: 2,
    },
    {
      date: "2026-07-13",
      netTotal: 50,
      grossTotal: 50,
      salesCount: 1,
    },
    {
      date: "2026-07-21",
      netTotal: 120,
      grossTotal: 120,
      salesCount: 3,
    },
  ]);
  assert.deepEqual(result, [
    {
      weekday: 1,
      weekdayName: "segunda-feira",
      netTotal: 150,
      salesCount: 3,
    },
    {
      weekday: 2,
      weekdayName: "terça-feira",
      netTotal: 120,
      salesCount: 3,
    },
  ]);
});

test("formata moeda e limita séries longas para WhatsApp", () => {
  assert.match(formatCurrency(184_320.5), /184\.320,50/);
  const list = formatSalesByDay(
    "últimos 30 dias",
    Array.from({ length: 12 }, (_, index) => ({
      date: `2026-07-${String(index + 1).padStart(2, "0")}`,
      netTotal: index,
      grossTotal: index,
      salesCount: 1,
    })),
  );
  assert.match(list, /Mostrando os 10 dias mais recentes/);
  assert.doesNotMatch(list, /12\/07\/2026/);
});

test("resumo não inventa produto ou dia quando não existem", () => {
  const value = formatBusinessSummary({
    totals: {
      period,
      grossTotal: 0,
      netTotal: 0,
      discountTotal: 0,
      cancelledTotal: 0,
      salesCount: 0,
      itemsQuantity: 0,
      hasData: false,
    },
    averageTicket: 0,
    averagePerDay: 0,
    topProduct: null,
    bestWeekday: null,
    lastDataUpdate: null,
  });
  assert.match(value, /Produto mais vendido: não disponível/);
  assert.match(value, /Melhor dia da semana: não disponível/);
});
