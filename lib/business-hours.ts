import { DEFAULT_ORGANIZATION_ID, isInsideBusinessHours } from "@/lib/utils";
import { getBusinessHour } from "@/lib/repo";
import { queryTenantDatabase } from "@/lib/db";

const BRAZIL_TZ = "America/Sao_Paulo";

type BusinessSchedule = {
  startTime: string;
  endTime: string;
};

type ConfiguredBusinessHour = BusinessSchedule & {
  isActive?: boolean;
  breakStartTime?: string | null;
  breakEndTime?: string | null;
};

type Environment = Readonly<Record<string, string | undefined>>;

const VALID_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function configuredTime(
  environment: Environment,
  name: string,
  fallback: string,
): string {
  const value = String(environment[name] || "").trim();
  return VALID_TIME.test(value) ? value : fallback;
}

function configuredClosed(environment: Environment, name: string): boolean {
  return ["1", "true", "yes", "on"].includes(
    String(environment[name] || "").trim().toLowerCase(),
  );
}

/**
 * Fallback operacional quando a organização ainda não cadastrou os horários no
 * banco. Os horários exibidos ao cliente continuam vindo de SUPERMARKET_HOURS_*;
 * estes valores controlam apenas a decisão automática de aberto/fechado.
 */
export function getDefaultBusinessSchedule(
  weekday: number,
  environment: Environment = process.env,
): BusinessSchedule | null {
  const weekdayStart = configuredTime(
    environment,
    "BUSINESS_HOURS_WEEKDAY_START",
    "07:00",
  );
  const weekdayEnd = configuredTime(
    environment,
    "BUSINESS_HOURS_WEEKDAY_END",
    "21:00",
  );

  if (weekday === 0) {
    if (configuredClosed(environment, "BUSINESS_HOURS_SUNDAY_CLOSED")) {
      return null;
    }
    return {
      startTime: configuredTime(
        environment,
        "BUSINESS_HOURS_SUNDAY_START",
        "08:00",
      ),
      endTime: configuredTime(
        environment,
        "BUSINESS_HOURS_SUNDAY_END",
        "14:00",
      ),
    };
  }

  if (weekday === 6) {
    if (configuredClosed(environment, "BUSINESS_HOURS_SATURDAY_CLOSED")) {
      return null;
    }
    return {
      startTime: configuredTime(
        environment,
        "BUSINESS_HOURS_SATURDAY_START",
        weekdayStart,
      ),
      endTime: configuredTime(
        environment,
        "BUSINESS_HOURS_SATURDAY_END",
        weekdayEnd,
      ),
    };
  }

  if (weekday >= 1 && weekday <= 5) {
    if (configuredClosed(environment, "BUSINESS_HOURS_WEEKDAY_CLOSED")) {
      return null;
    }
    return { startTime: weekdayStart, endTime: weekdayEnd };
  }

  return null;
}

export function resolveBusinessSchedule(
  weekday: number,
  configured: ConfiguredBusinessHour | null,
  environment: Environment = process.env,
): BusinessSchedule | null {
  if (configured?.isActive === false) return null;
  if (configured) {
    return {
      startTime: String(configured.startTime || "07:00"),
      endTime: String(configured.endTime || "21:00"),
    };
  }
  return getDefaultBusinessSchedule(weekday, environment);
}

function getWeekdayAndTime(date: Date, timeZone: string): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const weekdayText = parts.find((p) => p.type === "weekday")?.value || "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value || "0") % 24;
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
  let timezone = BRAZIL_TZ;
  try {
    const location = await queryTenantDatabase<{ timezone: string | null }>(organizationId, "SELECT timezone FROM business_locations WHERE organization_id=$1 LIMIT 1", [organizationId]);
    if (location.rows[0]?.timezone) timezone = String(location.rows[0].timezone);
  } catch {
    // Instalações anteriores à migration de localização continuam com o fuso padrão.
  }
  const { weekday, hour, minute } = getWeekdayAndTime(date, timezone);
  const configured = await getBusinessHour(organizationId, weekday);
  const schedule = resolveBusinessSchedule(weekday, configured);

  if (!schedule) return false;

  // Reuse existing helper by building a date with Brazil local hh:mm.
  const brazilLikeDate = new Date(date);
  brazilLikeDate.setHours(hour, minute, 0, 0);
  const open = isInsideBusinessHours(brazilLikeDate, schedule.startTime, schedule.endTime);
  if (!open || !configured?.breakStartTime || !configured.breakEndTime) return open;
  return !isInsideBusinessHours(brazilLikeDate, configured.breakStartTime, configured.breakEndTime);
}
