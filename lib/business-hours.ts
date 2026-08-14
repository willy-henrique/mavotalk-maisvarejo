import { DEFAULT_ORGANIZATION_ID, isInsideTimeRange } from "@/lib/utils";
import { getBusinessHour } from "@/lib/repo";
import { getOrganizationTimeZone } from "@/lib/organization-timezone";
import { zonedParts } from "@/lib/timezone";

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

export async function isOpenBusinessHour(date = new Date(), organizationId = DEFAULT_ORGANIZATION_ID) {
  const timezone = await getOrganizationTimeZone(organizationId);
  const { weekday, minutesOfDay } = zonedParts(date, timezone);
  const configured = await getBusinessHour(organizationId, weekday);
  const schedule = resolveBusinessSchedule(weekday, configured);

  if (!schedule) return false;

  const open = isInsideTimeRange(minutesOfDay, schedule.startTime, schedule.endTime);
  if (!open || !configured?.breakStartTime || !configured.breakEndTime) return open;
  return !isInsideTimeRange(minutesOfDay, configured.breakStartTime, configured.breakEndTime);
}
