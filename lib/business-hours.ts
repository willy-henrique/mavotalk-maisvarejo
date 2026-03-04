import { DEFAULT_ORGANIZATION_ID, isInsideBusinessHours } from "@/lib/utils";
import { getBusinessHour } from "@/lib/repo";

export async function isOpenBusinessHour(date = new Date(), organizationId = DEFAULT_ORGANIZATION_ID) {
  const weekday = date.getDay();
  const hour = await getBusinessHour(organizationId, weekday);

  if (!hour) return false;

  return isInsideBusinessHours(date, String(hour.startTime), String(hour.endTime));
}
