import { NextResponse } from "next/server";
import { requireSupermarketAdmin } from "@/lib/supermarket-admin-auth";
import { createAuditLog } from "@/lib/repo";
import {
  getConfiguredBusinessHours,
  getSupermarketSettings,
  updateConfiguredBusinessHours,
  updateSupermarketSettings,
  type ConfiguredHour,
} from "@/lib/supermarket-settings";
import { parseSupermarketSettingsPatch } from "@/lib/supermarket-settings-validation";

function parseHours(value: unknown): ConfiguredHour[] | null {
  if (!Array.isArray(value)) return null;
  const hours: ConfiguredHour[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const weekday = Number(row.weekday);
    const startTime = String(row.startTime || "");
    const endTime = String(row.endTime || "");
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) continue;
    hours.push({
      weekday,
      startTime,
      endTime,
      timezone: String(row.timezone || "America/Sao_Paulo").slice(0, 80),
      isActive: row.isActive !== false,
    });
  }
  return hours;
}

export async function GET(request: Request) {
  const auth = await requireSupermarketAdmin(request);
  if (auth.error || !auth.session) return auth.error;
  const [settings, businessHours] = await Promise.all([
    getSupermarketSettings(auth.session.organizationId),
    getConfiguredBusinessHours(auth.session.organizationId),
  ]);
  return NextResponse.json({ settings, businessHours });
}

export async function PATCH(request: Request) {
  const auth = await requireSupermarketAdmin(request);
  if (auth.error || !auth.session) return auth.error;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  const parsedSettings = parseSupermarketSettingsPatch(body);
  if (parsedSettings.error) return NextResponse.json({ error: parsedSettings.error }, { status: 422 });
  const settings = await updateSupermarketSettings(auth.session.organizationId, parsedSettings.data);
  const hours = parseHours(body.businessHours);
  const businessHours = hours ? await updateConfiguredBusinessHours(auth.session.organizationId, hours) : await getConfiguredBusinessHours(auth.session.organizationId);
  await createAuditLog(auth.session.organizationId, auth.session.userId, "update_supermarket_settings", "organization", auth.session.organizationId, {
    fields: Object.keys(body),
    origin: auth.session.userId ? "operational-admin" : "mavo-master",
  });
  return NextResponse.json({ settings, businessHours });
}
