import { mavoConfig } from "@/lib/config/mavo-config";

/**
 * O servidor roda em UTC (Render), mas quem lê as mensagens é o cliente da loja.
 * Toda data enviada ao WhatsApp ou exibida no painel precisa ser formatada no
 * fuso da loja — sem isso, uma promoção que expira às 22:00 aparece como 01:00
 * do dia seguinte, três horas à frente e num dia que não existe para o cliente.
 */
export function defaultTimeZone(): string {
  return isSupportedTimeZone(mavoConfig.defaultTimezone)
    ? mavoConfig.defaultTimezone
    : "America/Sao_Paulo";
}

export function isSupportedTimeZone(value: unknown): boolean {
  const candidate = String(value ?? "").trim();
  if (!candidate) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

/** Nunca lança: um fuso inválido gravado no banco não pode derrubar o bot. */
export function resolveTimeZone(value: unknown): string {
  const candidate = String(value ?? "").trim();
  return isSupportedTimeZone(candidate) ? candidate : defaultTimeZone();
}

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = domingo, para casar com `business_hours.weekday`. */
  weekday: number;
  /** `YYYY-MM-DD` no fuso informado. */
  dateKey: string;
  minutesOfDay: number;
};

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const pad = (value: number) => String(value).padStart(2, "0");

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const zone = resolveTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  const year = Number(read("year"));
  const month = Number(read("month"));
  const day = Number(read("day"));
  const hour = Number(read("hour"));
  const minute = Number(read("minute"));

  return {
    year,
    month,
    day,
    hour,
    minute,
    second: Number(read("second")),
    weekday: WEEKDAY_INDEX[read("weekday")] ?? 0,
    dateKey: `${year}-${pad(month)}-${pad(day)}`,
    minutesOfDay: hour * 60 + minute,
  };
}

/** `dd/MM/yyyy` no fuso da loja. */
export function formatZonedDate(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return `${pad(parts.day)}/${pad(parts.month)}/${parts.year}`;
}

/** `HH:MM` em 24 horas, o formato que a operação usa nos cadastros. */
export function formatZonedTime(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatZonedDateTime(date: Date, timeZone: string): string {
  return `${formatZonedDate(date, timeZone)} às ${formatZonedTime(date, timeZone)}`;
}

/** Diferença em dias de calendário no fuso da loja, ignorando as horas. */
export function zonedDayDistance(from: Date, to: Date, timeZone: string): number {
  const start = zonedParts(from, timeZone);
  const end = zonedParts(to, timeZone);
  const dayMs = 86_400_000;
  return Math.round(
    (Date.UTC(end.year, end.month - 1, end.day) - Date.UTC(start.year, start.month - 1, start.day)) / dayMs,
  );
}

/**
 * Prazo em linguagem de cliente. "Válida até 15/08/2026, 01:00" faz o cliente
 * achar que a oferta vale amanhã; "hoje às 23:59" resolve a dúvida na primeira
 * leitura e continua batendo com o horário cadastrado no painel.
 */
export function describeZonedDeadline(date: Date, timeZone: string, now = new Date()): string {
  const time = formatZonedTime(date, timeZone);
  const distance = zonedDayDistance(now, date, timeZone);
  if (distance === 0) return `hoje às ${time}`;
  if (distance === 1) return `amanhã às ${time}`;
  return `${formatZonedDate(date, timeZone)} às ${time}`;
}