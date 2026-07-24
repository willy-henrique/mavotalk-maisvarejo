import { DEFAULT_ORGANIZATION_ID, isInsideBusinessHours } from "@/lib/utils";
import { getBusinessHour } from "@/lib/repo";

const BRAZIL_TZ = "America/Sao_Paulo";

const DEFAULT_SCHEDULE: Record<number, { startTime: string; endTime: string } | null> = {
  0: null, // domingo
  1: { startTime: "07:00", endTime: "18:00" }, // segunda
  2: { startTime: "07:00", endTime: "18:00" }, // terca
  3: { startTime: "07:00", endTime: "18:00" }, // quarta
  4: { startTime: "07:00", endTime: "18:00" }, // quinta
  5: { startTime: "07:00", endTime: "18:00" }, // sexta
  6: { startTime: "07:00", endTime: "17:00" }, // sabado
};

function getBrazilWeekdayAndTime(date: Date): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BRAZIL_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const weekdayText = parts.find((p) => p.type === "weekday")?.value || "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value || "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value || "0");

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    weekday: weekdayMap[weekdayText] ?? 0,
    hour,
    minute,
  };
}

export async function isOpenBusinessHour(date = new Date(), organizationId = DEFAULT_ORGANIZATION_ID) {
  const { weekday, hour, minute } = getBrazilWeekdayAndTime(date);
  const configured = await getBusinessHour(organizationId, weekday);
  const schedule =
    configured
      ? {
          startTime: String(configured.startTime || "07:00"),
          endTime: String(configured.endTime || "18:00"),
        }
      : DEFAULT_SCHEDULE[weekday];

  if (!schedule) return false;

  // Reuse existing helper by building a date with Brazil local hh:mm.
  const brazilLikeDate = new Date(date);
  brazilLikeDate.setHours(hour, minute, 0, 0);
  return isInsideBusinessHours(brazilLikeDate, schedule.startTime, schedule.endTime);
}
