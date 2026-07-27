import { NextResponse } from "next/server";
import { requireSupermarketAdmin } from "@/lib/supermarket-admin-auth";
import { createAuditLog } from "@/lib/repo";
import {
  getConfiguredBusinessHours,
  getSupermarketSettings,
  updateConfiguredBusinessHours,
  updateSupermarketSettings,
  type ConfiguredHour,
  type SupermarketSettings,
} from "@/lib/supermarket-settings";

const text = (value: unknown, max: number) => {
  if (value == null) return null;
  const result = String(value).trim();
  return result ? result.slice(0, max) : null;
};

function parseSettings(body: Record<string, unknown>): Partial<SupermarketSettings> {
  const next: Partial<SupermarketSettings> = {};
  if (typeof body.enabled === "boolean") next.enabled = body.enabled;
  if (typeof body.aiFallbackEnabled === "boolean") next.aiFallbackEnabled = body.aiFallbackEnabled;
  for (const [input, key, max] of [
    ["botName", "botName", 80],
    ["storeName", "storeName", 160],
    ["address", "address", 300],
    ["mapsUrl", "mapsUrl", 1000],
    ["weekdayHours", "weekdayHours", 160],
    ["sundayHours", "sundayHours", 160],
    ["offersUrl", "offersUrl", 1000],
    ["offersText", "offersText", 4000],
    ["phone", "phone", 40],
  ] as const) {
    if (input in body) (next as Record<string, unknown>)[key] = text(body[input], max);
  }
  return next;
}

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

export async function GET() {
  const auth = await requireSupermarketAdmin();
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
  const settings = await updateSupermarketSettings(auth.session.organizationId, parseSettings(body));
  const hours = parseHours(body.businessHours);
  const businessHours = hours ? await updateConfiguredBusinessHours(auth.session.organizationId, hours) : await getConfiguredBusinessHours(auth.session.organizationId);
  await createAuditLog(auth.session.organizationId, auth.session.userId, "update_supermarket_settings", "organization", auth.session.organizationId, {
    fields: Object.keys(body),
    origin: auth.session.userId ? "operational-admin" : "mavo-master",
  });
  return NextResponse.json({ settings, businessHours });
}
