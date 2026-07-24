import type { BusinessPeriod } from "@/lib/business-analytics/types";

function datePartsInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
  };
}

function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function utcDateFromParts(parts: { year: number; month: number; day: number }) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function firstAndLastOfMonth(year: number, month: number) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: formatDate(year, month, 1),
    to: formatDate(year, month, lastDay),
  };
}

function displayDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const candidate = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(candidate.getTime()) &&
    candidate.toISOString().slice(0, 10) === value
  );
}

export function businessPeriodFromIsoRange(input: {
  from: string;
  to: string;
  timezone?: string;
  label?: string;
}): BusinessPeriod {
  if (
    !isValidIsoDate(input.from) ||
    !isValidIsoDate(input.to) ||
    input.to < input.from
  ) {
    const error = new Error("Intervalo de datas inválido");
    Object.assign(error, { code: "INVALID_PERIOD", status: 400 });
    throw error;
  }
  if (daysInPeriod(input) > 366) {
    const error = new Error("O intervalo máximo é de 366 dias");
    Object.assign(error, { code: "PERIOD_TOO_LARGE", status: 400 });
    throw error;
  }
  return {
    from: input.from,
    to: input.to,
    label:
      input.label || `${displayDate(input.from)} a ${displayDate(input.to)}`,
    timezone: input.timezone || "America/Sao_Paulo",
  };
}

function explicitDate(day: string, month: string, year: string): string | null {
  const y = Number(year.length === 2 ? `20${year}` : year);
  const m = Number(month);
  const d = Number(day);
  const candidate = new Date(Date.UTC(y, m - 1, d));
  if (
    candidate.getUTCFullYear() !== y ||
    candidate.getUTCMonth() + 1 !== m ||
    candidate.getUTCDate() !== d
  ) {
    return null;
  }
  return formatDate(y, m, d);
}

export function daysInPeriod(period: Pick<BusinessPeriod, "from" | "to">): number {
  const from = new Date(`${period.from}T00:00:00.000Z`).getTime();
  const to = new Date(`${period.to}T00:00:00.000Z`).getTime();
  return Math.max(0, Math.floor((to - from) / 86_400_000) + 1);
}

export function parseBusinessPeriod(
  input: string,
  options: {
    timezone?: string;
    now?: Date;
    defaultPeriod?: "today" | "month" | "last30";
  } = {},
): BusinessPeriod {
  const timezone = options.timezone || "America/Sao_Paulo";
  const now = options.now || new Date();
  const todayParts = datePartsInTimezone(now, timezone);
  const today = formatDate(todayParts.year, todayParts.month, todayParts.day);
  const normalized = input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

  const explicit = normalized.match(
    /(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\s*(?:a|ate|até|-)\s*(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/,
  );
  if (explicit) {
    const from = explicitDate(explicit[1], explicit[2], explicit[3]);
    const to = explicitDate(explicit[4], explicit[5], explicit[6]);
    if (!from || !to) {
      const error = new Error("Intervalo de datas inválido");
      Object.assign(error, { code: "INVALID_PERIOD", status: 400 });
      throw error;
    }
    return businessPeriodFromIsoRange({
      from,
      to,
      label: `${displayDate(from)} a ${displayDate(to)}`,
      timezone,
    });
  }

  if (/\bontem\b/.test(normalized)) {
    const date = addDays(today, -1);
    return { from: date, to: date, label: "ontem", timezone };
  }
  if (/\bhoje\b/.test(normalized)) {
    return { from: today, to: today, label: "hoje", timezone };
  }

  const lastDays = normalized.match(
    /(?:ultim[oa]s?|últim[oa]s?)\s*(7|15|30|60|90)\s*dias?/,
  );
  if (lastDays) {
    const amount = Number(lastDays[1]);
    return {
      from: addDays(today, -(amount - 1)),
      to: today,
      label: `últimos ${amount} dias`,
      timezone,
    };
  }

  const todayUtc = utcDateFromParts(todayParts);
  const weekday = todayUtc.getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  if (normalized.includes("semana passada")) {
    const thisMonday = addDays(today, -daysSinceMonday);
    const from = addDays(thisMonday, -7);
    return {
      from,
      to: addDays(from, 6),
      label: "semana passada",
      timezone,
    };
  }
  if (
    normalized.includes("esta semana") ||
    normalized.includes("essa semana")
  ) {
    return {
      from: addDays(today, -daysSinceMonday),
      to: today,
      label: "esta semana",
      timezone,
    };
  }

  if (normalized.includes("mes passado")) {
    const month = todayParts.month === 1 ? 12 : todayParts.month - 1;
    const year =
      todayParts.month === 1 ? todayParts.year - 1 : todayParts.year;
    const range = firstAndLastOfMonth(year, month);
    return { ...range, label: "mês passado", timezone };
  }
  if (
    normalized.includes("este mes") ||
    normalized.includes("esse mes") ||
    normalized.includes("no mes") ||
    normalized.includes("do mes")
  ) {
    return {
      from: formatDate(todayParts.year, todayParts.month, 1),
      to: today,
      label: "este mês",
      timezone,
    };
  }

  const defaultPeriod = options.defaultPeriod || "month";
  if (defaultPeriod === "today") {
    return { from: today, to: today, label: "hoje", timezone };
  }
  if (defaultPeriod === "last30") {
    return {
      from: addDays(today, -29),
      to: today,
      label: "últimos 30 dias",
      timezone,
    };
  }
  return {
    from: formatDate(todayParts.year, todayParts.month, 1),
    to: today,
    label: "este mês",
    timezone,
  };
}

export function previousComparablePeriod(period: BusinessPeriod): BusinessPeriod {
  const days = daysInPeriod(period);
  const to = addDays(period.from, -1);
  const from = addDays(to, -(days - 1));
  return {
    from,
    to,
    label: `período anterior (${displayDate(from)} a ${displayDate(to)})`,
    timezone: period.timezone,
  };
}
