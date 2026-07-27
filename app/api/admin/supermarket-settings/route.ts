import { NextResponse } from "next/server";
import { requireSupermarketAdmin } from "@/lib/supermarket-admin-auth";
import { createAuditLog } from "@/lib/repo";
import {
  getConfiguredBusinessHours,
  getSupermarketSettings,
  updateSupermarketConfiguration,
} from "@/lib/supermarket-settings";
import { parseBusinessHoursPatch, parseSupermarketSettingsPatch } from "@/lib/supermarket-settings-validation";

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
  const parsedHours = parseBusinessHoursPatch(body.businessHours);
  if (parsedHours.error) return NextResponse.json({ error: parsedHours.error }, { status: 422 });
  const { settings, businessHours } = await updateSupermarketConfiguration(
    auth.session.organizationId,
    parsedSettings.data,
    parsedHours.data,
  );
  await createAuditLog(auth.session.organizationId, auth.session.userId, "update_supermarket_settings", "organization", auth.session.organizationId, {
    fields: Object.keys(body),
    origin: auth.session.userId ? "operational-admin" : "mavo-master",
  });
  return NextResponse.json({ settings, businessHours });
}
