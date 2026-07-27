import { queryTenantDatabase } from "@/lib/db";
import { getSupermarketBotConfig, type SupermarketBotConfig } from "@/lib/supermarket-bot";

export type SupermarketSettings = {
  enabled: boolean;
  botName: string;
  storeName: string;
  address: string | null;
  mapsUrl: string | null;
  weekdayHours: string | null;
  sundayHours: string | null;
  offersUrl: string | null;
  offersText: string | null;
  offersImageUrl: string | null;
  offersImagePublicId: string | null;
  phone: string | null;
  aiFallbackEnabled: boolean;
};

export type ConfiguredHour = {
  weekday: number;
  startTime: string;
  endTime: string;
  timezone: string;
  isActive: boolean;
};

const columns = `
  bot_enabled, bot_name, store_name, bot_address, bot_maps_url,
  bot_weekday_hours, bot_sunday_hours, bot_offers_url, bot_offers_text,
  bot_offers_image_url, bot_offers_image_public_id, bot_phone,
  bot_ai_fallback_enabled
`;

function nullable(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

export function mapSettings(row: Record<string, unknown>, fallback = getSupermarketBotConfig()): SupermarketSettings {
  return {
    enabled: typeof row.bot_enabled === "boolean" ? row.bot_enabled : fallback.enabled,
    botName: nullable(row.bot_name) || fallback.botName,
    storeName: nullable(row.store_name) || fallback.storeName,
    address: nullable(row.bot_address) ?? fallback.address,
    mapsUrl: nullable(row.bot_maps_url) ?? fallback.mapsUrl,
    weekdayHours: nullable(row.bot_weekday_hours) ?? fallback.weekdayHours,
    sundayHours: nullable(row.bot_sunday_hours) ?? fallback.sundayHours,
    offersUrl: nullable(row.bot_offers_url) ?? fallback.offersUrl,
    offersText: nullable(row.bot_offers_text) ?? fallback.offersText,
    offersImageUrl: nullable(row.bot_offers_image_url) ?? fallback.offersImageUrl,
    offersImagePublicId: nullable(row.bot_offers_image_public_id) ?? fallback.offersImagePublicId,
    phone: nullable(row.bot_phone) ?? fallback.phone,
    aiFallbackEnabled: typeof row.bot_ai_fallback_enabled === "boolean"
      ? row.bot_ai_fallback_enabled
      : fallback.aiFallbackEnabled,
  };
}

export async function getSupermarketSettings(organizationId: string): Promise<SupermarketSettings> {
  try {
    const result = await queryTenantDatabase<Record<string, unknown>>(
      organizationId,
      `SELECT ${columns} FROM organizations WHERE id = $1 LIMIT 1`,
      [organizationId],
    );
    return mapSettings(result.rows[0] || {});
  } catch {
    // The environment remains a safe fallback while an older database is
    // being migrated. This also keeps local development bootable.
    return mapSettings({});
  }
}

export async function getSupermarketBotConfigForOrganization(organizationId: string): Promise<SupermarketBotConfig> {
  return getSupermarketSettings(organizationId);
}

export async function updateSupermarketSettings(
  organizationId: string,
  input: Partial<SupermarketSettings>,
): Promise<SupermarketSettings> {
  const current = await getSupermarketSettings(organizationId);
  const next: SupermarketSettings = { ...current, ...input };
  await queryTenantDatabase(
    organizationId,
    `UPDATE organizations SET
      bot_enabled = $2,
      bot_name = $3,
      store_name = $4,
      bot_address = $5,
      bot_maps_url = $6,
      bot_weekday_hours = $7,
      bot_sunday_hours = $8,
      bot_offers_url = $9,
      bot_offers_text = $10,
      bot_offers_image_url = $11,
      bot_offers_image_public_id = $12,
      bot_phone = $13,
      bot_ai_fallback_enabled = $14,
      updated_at = now()
     WHERE id = $1`,
    [
      organizationId,
      next.enabled,
      next.botName,
      next.storeName,
      next.address,
      next.mapsUrl,
      next.weekdayHours,
      next.sundayHours,
      next.offersUrl,
      next.offersText,
      next.offersImageUrl,
      next.offersImagePublicId,
      next.phone,
      next.aiFallbackEnabled,
    ],
  );
  return next;
}

export async function getConfiguredBusinessHours(organizationId: string): Promise<ConfiguredHour[]> {
  try {
    const result = await queryTenantDatabase<Record<string, unknown>>(
      organizationId,
      `SELECT weekday, start_time, end_time, timezone, is_active
         FROM business_hours WHERE organization_id = $1 ORDER BY weekday ASC`,
      [organizationId],
    );
    return result.rows.map((row) => ({
      weekday: Number(row.weekday),
      startTime: String(row.start_time || "08:00"),
      endTime: String(row.end_time || "18:00"),
      timezone: String(row.timezone || "America/Sao_Paulo"),
      isActive: row.is_active !== false,
    }));
  } catch {
    return [];
  }
}

export async function updateConfiguredBusinessHours(
  organizationId: string,
  hours: ConfiguredHour[],
): Promise<ConfiguredHour[]> {
  for (const hour of hours) {
    await queryTenantDatabase(
      organizationId,
      `INSERT INTO business_hours (organization_id, weekday, start_time, end_time, timezone, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (organization_id, weekday) DO UPDATE SET
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         timezone = EXCLUDED.timezone,
         is_active = EXCLUDED.is_active`,
      [organizationId, hour.weekday, hour.startTime, hour.endTime, hour.timezone, hour.isActive],
    );
  }
  return getConfiguredBusinessHours(organizationId);
}
