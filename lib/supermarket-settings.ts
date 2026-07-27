import { queryTenantDatabase, withTenantTransaction } from "@/lib/db";
import type { PoolClient } from "pg";
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

const upsertBusinessHoursSql = `
  INSERT INTO business_hours (organization_id, weekday, start_time, end_time, timezone, is_active)
  SELECT $1, item.weekday, item.start_time, item.end_time, item.timezone, item.is_active
    FROM jsonb_to_recordset($2::jsonb) AS item(
      weekday integer,
      start_time text,
      end_time text,
      timezone text,
      is_active boolean
    )
  ON CONFLICT (organization_id, weekday) DO UPDATE SET
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    timezone = EXCLUDED.timezone,
    is_active = EXCLUDED.is_active`;

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

function settingsValues(organizationId: string, settings: SupermarketSettings) {
  return [
    organizationId, settings.enabled, settings.botName, settings.storeName,
    settings.address, settings.mapsUrl, settings.weekdayHours, settings.sundayHours,
    settings.offersUrl, settings.offersText, settings.offersImageUrl,
    settings.offersImagePublicId, settings.phone, settings.aiFallbackEnabled,
  ];
}

async function updateSettingsWithClient(client: PoolClient, organizationId: string, settings: SupermarketSettings) {
  await client.query(
    `UPDATE organizations SET
      bot_enabled = $2, bot_name = $3, store_name = $4, bot_address = $5,
      bot_maps_url = $6, bot_weekday_hours = $7, bot_sunday_hours = $8,
      bot_offers_url = $9, bot_offers_text = $10, bot_offers_image_url = $11,
      bot_offers_image_public_id = $12, bot_phone = $13,
      bot_ai_fallback_enabled = $14, updated_at = now()
     WHERE id = $1`,
    settingsValues(organizationId, settings),
  );
}

function hoursJson(hours: ConfiguredHour[]) {
  return JSON.stringify(hours.map((hour) => ({
    weekday: hour.weekday,
    start_time: hour.startTime,
    end_time: hour.endTime,
    timezone: hour.timezone,
    is_active: hour.isActive,
  })));
}

async function listConfiguredBusinessHoursWithClient(client: PoolClient, organizationId: string): Promise<ConfiguredHour[]> {
  const result = await client.query<Record<string, unknown>>(
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
}

/** Atualiza identidade, conteúdo e agenda como uma alteração indivisível do tenant. */
export async function updateSupermarketConfiguration(
  organizationId: string,
  input: Partial<SupermarketSettings>,
  hours?: ConfiguredHour[],
  audit?: { userId: string | null; metadata: Record<string, unknown> },
): Promise<{ settings: SupermarketSettings; businessHours: ConfiguredHour[] }> {
  return withTenantTransaction(organizationId, async (client) => {
    const currentResult = await client.query<Record<string, unknown>>(
      `SELECT ${columns} FROM organizations WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [organizationId],
    );
    const settings: SupermarketSettings = { ...mapSettings(currentResult.rows[0] || {}), ...input };
    await updateSettingsWithClient(client, organizationId, settings);
    if (hours?.length) await client.query(upsertBusinessHoursSql, [organizationId, hoursJson(hours)]);
    if (audit) {
      await client.query(
        `INSERT INTO audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
         VALUES ($1, $2, 'update_supermarket_settings', 'organization', $1, $3::jsonb)`,
        [organizationId, audit.userId, JSON.stringify(audit.metadata)],
      );
    }
    return { settings, businessHours: await listConfiguredBusinessHoursWithClient(client, organizationId) };
  });
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
  if (!hours.length) return getConfiguredBusinessHours(organizationId);
  await queryTenantDatabase(
    organizationId,
    `INSERT INTO business_hours (organization_id, weekday, start_time, end_time, timezone, is_active)
     SELECT $1, item.weekday, item.start_time, item.end_time, item.timezone, item.is_active
       FROM jsonb_to_recordset($2::jsonb) AS item(
         weekday integer,
         start_time text,
         end_time text,
         timezone text,
         is_active boolean
       )
     ON CONFLICT (organization_id, weekday) DO UPDATE SET
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time,
       timezone = EXCLUDED.timezone,
       is_active = EXCLUDED.is_active`,
    [
      organizationId,
      JSON.stringify(hours.map((hour) => ({
        weekday: hour.weekday,
        start_time: hour.startTime,
        end_time: hour.endTime,
        timezone: hour.timezone,
        is_active: hour.isActive,
      }))),
    ],
  );
  return getConfiguredBusinessHours(organizationId);
}
