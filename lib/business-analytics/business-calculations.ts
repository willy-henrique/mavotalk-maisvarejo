import type {
  BusinessPeriod,
  SalesByDayItem,
  SalesByWeekdayItem,
} from "@/lib/business-analytics/types";
import { daysInPeriod } from "@/lib/business-analytics/business-period-parser";

const weekdayNames = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;

export function averagePerCalendarDay(
  netTotal: number,
  period: Pick<BusinessPeriod, "from" | "to">,
): number {
  const days = daysInPeriod(period);
  return days > 0 && Number.isFinite(netTotal) ? netTotal / days : 0;
}

/**
 * Referência determinística usada por importadores/testes. O runtime faz a
 * mesma agregação no PostgreSQL para não carregar séries grandes em memória.
 */
export function aggregateSalesByWeekday(
  items: readonly SalesByDayItem[],
): SalesByWeekdayItem[] {
  const totals = new Map<number, { netTotal: number; salesCount: number }>();
  for (const item of items) {
    const weekday = new Date(`${item.date}T00:00:00.000Z`).getUTCDay();
    const previous = totals.get(weekday) || { netTotal: 0, salesCount: 0 };
    previous.netTotal += Number.isFinite(item.netTotal) ? item.netTotal : 0;
    previous.salesCount += Number.isFinite(item.salesCount)
      ? item.salesCount
      : 0;
    totals.set(weekday, previous);
  }
  return [...totals.entries()]
    .map(([weekday, value]) => ({
      weekday,
      weekdayName: weekdayNames[weekday],
      ...value,
    }))
    .sort(
      (left, right) =>
        right.netTotal - left.netTotal || left.weekday - right.weekday,
    );
}
