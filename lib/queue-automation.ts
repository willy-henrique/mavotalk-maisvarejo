import { randomUUID } from "node:crypto";
import { queryTenantDatabase, withTenantTransaction } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  businessHoursAutomationConfigSchema,
  businessHoursSchema,
  businessHourExceptionSchema,
  businessLocationSchema,
  customAutomationConfigSchema,
  offersAutomationConfigSchema,
  promotionInputSchema,
  queueConfigurationInputSchema,
  type BusinessHoursAutomationConfig,
  type BusinessHoursInput,
  type BusinessHourExceptionInput,
  type BusinessLocationInput,
  type OffersAutomationConfig,
  type PromotionInput,
  type QueueAutomationType,
  type QueueConfigurationInput,
} from "@/lib/queue-automation-schemas";

type JsonRecord = Record<string, unknown>;
type Row = Record<string, unknown>;

export async function recordQueueContentHistory(organizationId: string, queueId: string, userId: string, action: string, previousValue: unknown, newValue: unknown) {
  await queryTenantDatabase(organizationId, "INSERT INTO queue_configuration_history (organization_id,queue_id,configuration_version,action,previous_value,new_value,changed_by) VALUES ($1,$2,0,$3,$4::jsonb,$5::jsonb,$6)", [organizationId, queueId, action, JSON.stringify(previousValue ?? null), JSON.stringify(newValue ?? null), userId]);
}

const defaultGeneral = (queue: Row) => ({
  name: String(queue.name || ""), description: null, menuOption: Number(queue.menu_option || 1),
  defaultSlaMins: Number(queue.default_sla_mins || 30), colorHex: String(queue.color_hex || "#64748B"), icon: null,
  isActive: queue.is_active !== false, allowReturnToMenu: true, createTicketOnHumanHandoff: true,
});
const defaultAutomation = (type: QueueAutomationType) => type === "offers_promotions" ? ({
  initialMessage: "Confira nossas ofertas.", noContentMessage: "No momento não temos nenhuma oferta ativa.", closingMessage: null,
  allowHumanHandoff: true, showReturnToMenu: true, useAiFallback: false, enabled: true,
  beforeFlyerMessage: null, afterFlyerMessage: null, showValidity: true, maxFlyers: 5, deliveryMode: "all", orderBy: "display_order", returnToMenuAfterSend: false,
}) : type === "business_hours_location" ? ({
  initialMessage: "Confira nossos horários e localização.", noContentMessage: "Os horários da unidade ainda não foram configurados.", closingMessage: null,
  allowHumanHandoff: true, showReturnToMenu: true, useAiFallback: false, enabled: true,
  openMessage: "Estamos abertos agora e funcionamos hoje até {closingTime}.", closedMessage: "No momento estamos fechados.", intervalMessage: "No momento estamos no intervalo. Retornaremos hoje às {nextOpeningTime}.", specialHoursMessage: "Hoje funcionaremos em horário especial, das {openingTime} às {closingTime}.",
  showPhone: true, showAddress: true, showReferencePoint: true, showMapsUrl: true, showNextOpening: true,
}) : ({ initialMessage: "Olá! Como podemos ajudar?", noContentMessage: "Não há conteúdo disponível.", closingMessage: null, allowHumanHandoff: true, showReturnToMenu: true, useAiFallback: false, enabled: true });

function inferType(queue: Row): QueueAutomationType {
  if (queue.queue_type === "offers_promotions" || Number(queue.menu_option) === 1) return "offers_promotions";
  if (queue.queue_type === "business_hours_location" || Number(queue.menu_option) === 2) return "business_hours_location";
  return "custom";
}
function jsonObject(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function rowConfig(row: Row | undefined, queue: Row) {
  const storedType = row?.queue_type as QueueAutomationType | undefined;
  const queueType = storedType && storedType !== "custom" ? storedType : inferType(queue);
  return {
    id: row?.id ? String(row.id) : null, queueId: String(queue.id), queueType,
    status: row?.status === "published" ? "published" as const : "draft" as const,
    version: Number(row?.version || 0),
    generalConfig: { ...defaultGeneral(queue), ...jsonObject(row?.general_config) },
    automationConfig: { ...defaultAutomation(queueType), ...jsonObject(row?.automation_config) },
    publishedAt: row?.published_at ? String(row.published_at) : null, updatedAt: String(row?.updated_at || queue.updated_at || queue.created_at || ""),
    contentSnapshot: jsonObject(row?.content_snapshot),
  };
}

export async function getQueueAutomation(organizationId: string, queueId: string, status: "draft" | "published" = "draft") {
  const result = await queryTenantDatabase<Row>(organizationId, `SELECT q.*, c.id AS configuration_id, c.queue_type AS config_queue_type, c.status AS config_status, c.version AS config_version, c.general_config, c.automation_config, c.content_snapshot, c.published_at, c.updated_at AS config_updated_at
    FROM queues q LEFT JOIN queue_configurations c ON c.queue_id=q.id AND c.organization_id=q.organization_id AND c.status=$3
    WHERE q.organization_id=$1 AND q.id=$2 LIMIT 1`, [organizationId, queueId, status]);
  if (!result.rowCount) return null;
  const raw = result.rows[0];
  // A fila pode existir sem uma versão publicada. Nesse caso, não é seguro
  // fabricar defaults: o runtime do bot deve continuar no fluxo legado.
  if (status === "published" && !raw.configuration_id) return null;
  return rowConfig({ id: raw.configuration_id, queue_type: raw.config_queue_type, status: raw.config_status, version: raw.config_version, general_config: raw.general_config, automation_config: raw.automation_config, content_snapshot: raw.content_snapshot, published_at: raw.published_at, updated_at: raw.config_updated_at }, raw);
}

export async function saveQueueAutomationDraft(organizationId: string, queueId: string, userId: string, input: QueueConfigurationInput) {
  const parsed = queueConfigurationInputSchema.parse(input);
  return withTenantTransaction(organizationId, async (client) => {
    const queueResult = await client.query<Row>("SELECT * FROM queues WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, queueId]);
    if (!queueResult.rowCount) return null;
    const queue = queueResult.rows[0];
    const old = await client.query<Row>("SELECT * FROM queue_configurations WHERE organization_id=$1 AND queue_id=$2 AND status='draft' FOR UPDATE", [organizationId, queueId]);
    const previous = old.rows[0] ? { generalConfig: old.rows[0].general_config, automationConfig: old.rows[0].automation_config } : null;
    const saved = await client.query<Row>(`INSERT INTO queue_configurations (organization_id,queue_id,queue_type,status,version,general_config,automation_config,created_by,updated_by)
      VALUES ($1,$2,$3,'draft',1,$4::jsonb,$5::jsonb,$6,$6)
      ON CONFLICT (organization_id,queue_id,status) DO UPDATE SET queue_type=EXCLUDED.queue_type,general_config=EXCLUDED.general_config,automation_config=EXCLUDED.automation_config,updated_by=EXCLUDED.updated_by,updated_at=now()
      RETURNING *`, [organizationId, queueId, parsed.queueType, JSON.stringify(parsed.generalConfig), JSON.stringify(parsed.automationConfig), userId]);
    await client.query(`INSERT INTO queue_configuration_history (organization_id,queue_id,configuration_version,action,previous_value,new_value,changed_by)
      VALUES ($1,$2,$3,'save_draft',$4::jsonb,$5::jsonb,$6)`, [organizationId, queueId, Number(saved.rows[0].version), JSON.stringify(previous), JSON.stringify({ generalConfig: parsed.generalConfig, automationConfig: parsed.automationConfig }), userId]);
    return rowConfig(saved.rows[0], queue);
  });
}

async function validatePublish(client: import("pg").PoolClient, organizationId: string, queueId: string, input: QueueConfigurationInput) {
  const errors: Record<string, string> = {};
  if (input.queueType === "offers_promotions") {
    const invalid = await client.query<Row>(`SELECT p.id FROM promotions p WHERE p.organization_id=$1 AND p.queue_id=$2 AND NOT p.archived AND (p.expires_at <= p.starts_at OR NOT EXISTS (SELECT 1 FROM promotion_media m WHERE m.organization_id=p.organization_id AND m.promotion_id=p.id)) LIMIT 1`, [organizationId, queueId]);
    if (invalid.rowCount) errors.content = "Toda promoção não arquivada precisa ter imagem e datas válidas.";
  }
  if (input.queueType === "business_hours_location") {
    const location = await client.query<Row>("SELECT * FROM business_locations WHERE organization_id=$1 AND queue_id=$2 LIMIT 1", [organizationId, queueId]);
    if (!location.rowCount) errors.location = "Cadastre o endereço da unidade antes de publicar.";
    else if (!location.rows[0].city || !location.rows[0].state || !location.rows[0].address_line) errors.location = "Preencha endereço, cidade e estado.";
    const hours = await client.query<Row>("SELECT 1 FROM business_hours h JOIN business_locations l ON l.id=h.location_id AND l.organization_id=h.organization_id WHERE h.organization_id=$1 AND l.queue_id=$2 AND h.is_active=true LIMIT 1", [organizationId, queueId]);
    if (!hours.rowCount) errors.hours = "Configure ao menos um dia de funcionamento.";
  }
  return errors;
}

export async function publishQueueAutomation(organizationId: string, queueId: string, userId: string) {
  return withTenantTransaction(organizationId, async (client) => {
    const queueResult = await client.query<Row>("SELECT * FROM queues WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, queueId]);
    if (!queueResult.rowCount) return { configuration: null, errors: { queue: "Fila não encontrada." } };
    const draftResult = await client.query<Row>("SELECT * FROM queue_configurations WHERE organization_id=$1 AND queue_id=$2 AND status='draft' FOR UPDATE", [organizationId, queueId]);
    if (!draftResult.rowCount) return { configuration: null, errors: { draft: "Salve um rascunho antes de publicar." } };
    const draft = draftResult.rows[0];
    const input = queueConfigurationInputSchema.parse({ queueType: draft.queue_type, generalConfig: draft.general_config, automationConfig: draft.automation_config });
    const errors = await validatePublish(client, organizationId, queueId, input);
    if (Object.keys(errors).length) return { configuration: null, errors };
    let contentSnapshot: Record<string, unknown> = {};
    if (input.queueType === "business_hours_location") {
      const location = await client.query<Row>("SELECT * FROM business_locations WHERE organization_id=$1 AND queue_id=$2 LIMIT 1", [organizationId, queueId]);
      const locationId = location.rows[0]?.id;
      const [hours, exceptions] = locationId ? await Promise.all([
        client.query<Row>("SELECT * FROM business_hours WHERE organization_id=$1 AND location_id=$2 ORDER BY weekday", [organizationId, locationId]),
        client.query<Row>("SELECT * FROM business_special_hours WHERE organization_id=$1 AND location_id=$2 ORDER BY calendar_date", [organizationId, locationId]),
      ]) : [{ rows: [] }, { rows: [] }];
      contentSnapshot = { location: location.rows[0] || null, hours: hours.rows, exceptions: exceptions.rows };
    }
    if (input.queueType === "offers_promotions") {
      await client.query("UPDATE promotions SET published_at=now(),published_active=active,published_archived=archived,updated_at=now() WHERE organization_id=$1 AND queue_id=$2", [organizationId, queueId]);
    }
    const publishedCurrent = await client.query<Row>("SELECT version,general_config,automation_config,content_snapshot FROM queue_configurations WHERE organization_id=$1 AND queue_id=$2 AND status='published' FOR UPDATE", [organizationId, queueId]);
    const version = Number(publishedCurrent.rows[0]?.version || 0) + 1;
    const saved = await client.query<Row>(`INSERT INTO queue_configurations (organization_id,queue_id,queue_type,status,version,general_config,automation_config,content_snapshot,published_at,published_by,created_by,updated_by)
      VALUES ($1,$2,$3,'published',$4,$5::jsonb,$6::jsonb,$7::jsonb,now(),$8,$8,$8)
      ON CONFLICT (organization_id,queue_id,status) DO UPDATE SET queue_type=EXCLUDED.queue_type,version=EXCLUDED.version,general_config=EXCLUDED.general_config,automation_config=EXCLUDED.automation_config,content_snapshot=EXCLUDED.content_snapshot,published_at=now(),published_by=EXCLUDED.published_by,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`, [organizationId, queueId, input.queueType, version, JSON.stringify(input.generalConfig), JSON.stringify(input.automationConfig), JSON.stringify(contentSnapshot), userId]);
    await client.query("UPDATE queues SET name=$3,menu_option=$4,color_hex=$5,default_sla_mins=$6,is_active=$7,queue_type=$8,updated_at=now() WHERE organization_id=$1 AND id=$2", [organizationId, queueId, input.generalConfig.name, input.generalConfig.menuOption, input.generalConfig.colorHex, input.generalConfig.defaultSlaMins, input.generalConfig.isActive, input.queueType]);
    await client.query(`INSERT INTO queue_configuration_history (organization_id,queue_id,configuration_version,action,previous_value,new_value,changed_by) VALUES ($1,$2,$3,'publish',$4::jsonb,$5::jsonb,$6)`, [organizationId, queueId, version, JSON.stringify(publishedCurrent.rows[0] || null), JSON.stringify({ generalConfig: input.generalConfig, automationConfig: input.automationConfig }), userId]);
    return { configuration: rowConfig(saved.rows[0], { ...queueResult.rows[0], name: input.generalConfig.name, menu_option: input.generalConfig.menuOption, color_hex: input.generalConfig.colorHex, default_sla_mins: input.generalConfig.defaultSlaMins, is_active: input.generalConfig.isActive }), errors: {} };
  });
}

export async function discardQueueAutomationDraft(organizationId: string, queueId: string, userId: string) {
  return withTenantTransaction(organizationId, async (client) => {
    const result = await client.query<Row>("DELETE FROM queue_configurations WHERE organization_id=$1 AND queue_id=$2 AND status='draft' RETURNING version", [organizationId, queueId]);
    if (result.rowCount) await client.query("INSERT INTO queue_configuration_history (organization_id,queue_id,configuration_version,action,changed_by) VALUES ($1,$2,$3,'discard_draft',$4)", [organizationId, queueId, Number(result.rows[0].version), userId]);
    return Boolean(result.rowCount);
  });
}

export async function listQueueAutomationHistory(organizationId: string, queueId: string) {
  const result = await queryTenantDatabase<Row>(organizationId, `SELECT h.*, u.name AS changed_by_name FROM queue_configuration_history h LEFT JOIN users u ON u.id=h.changed_by AND u.organization_id=h.organization_id WHERE h.organization_id=$1 AND h.queue_id=$2 ORDER BY h.created_at DESC LIMIT 100`, [organizationId, queueId]);
  return result.rows.map((row) => ({ id: String(row.id), version: Number(row.configuration_version), action: String(row.action), previousValue: row.previous_value, newValue: row.new_value, changedBy: row.changed_by_name || null, createdAt: String(row.created_at) }));
}

export async function getPublishedQueueConfiguration(organizationId: string, queueId: string) { return getQueueAutomation(organizationId, queueId, "published"); }

export async function listPublishedQueueConfigurations(organizationId: string) {
  const result = await queryTenantDatabase<Row>(organizationId, "SELECT * FROM queue_configurations WHERE organization_id=$1 AND status='published'", [organizationId]);
  return result.rows;
}

export async function saveBusinessLocation(organizationId: string, queueId: string, input: BusinessLocationInput) {
  const value = businessLocationSchema.parse(input);
  const result = await queryTenantDatabase<Row>(organizationId, `INSERT INTO business_locations (organization_id,queue_id,store_name,display_name,address_line,unit_number,complement,district,neighborhood,city,state,postal_code,reference_point,landmark,phone,whatsapp,maps_url,latitude,longitude,timezone,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$12,$13,$14,$15,$16,$17,$18,now())
    ON CONFLICT (organization_id,queue_id) WHERE queue_id IS NOT NULL DO UPDATE SET store_name=EXCLUDED.store_name,display_name=EXCLUDED.display_name,address_line=EXCLUDED.address_line,unit_number=EXCLUDED.unit_number,complement=EXCLUDED.complement,district=EXCLUDED.district,neighborhood=EXCLUDED.neighborhood,city=EXCLUDED.city,state=EXCLUDED.state,postal_code=EXCLUDED.postal_code,reference_point=EXCLUDED.reference_point,landmark=EXCLUDED.landmark,phone=EXCLUDED.phone,whatsapp=EXCLUDED.whatsapp,maps_url=EXCLUDED.maps_url,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,timezone=EXCLUDED.timezone,updated_at=now() RETURNING *`, [organizationId, queueId, value.unitName, value.displayName || null, value.address, value.number || null, value.complement || null, value.district || null, value.city, value.state, value.postalCode || null, value.referencePoint || null, value.phone || null, value.whatsapp || null, value.mapsUrl || null, value.latitude || null, value.longitude || null, value.timezone]);
  return result.rows[0];
}

export async function saveBusinessHours(organizationId: string, queueId: string, hours: BusinessHoursInput) {
  const parsed = businessHoursSchema.parse(hours);
  return withTenantTransaction(organizationId, async (client) => {
    const location = await client.query<Row>("SELECT id FROM business_locations WHERE organization_id=$1 AND queue_id=$2 FOR UPDATE", [organizationId, queueId]);
    if (!location.rowCount) throw new Error("Cadastre a unidade antes dos horários.");
    const locationId = String(location.rows[0].id);
    for (const hour of parsed) await client.query(`INSERT INTO business_hours (organization_id,location_id,weekday,start_time,end_time,second_start_time,second_end_time,is_active,timezone,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT timezone FROM business_locations WHERE id=$2),now())
      ON CONFLICT (organization_id,weekday) DO UPDATE SET location_id=EXCLUDED.location_id,start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,second_start_time=EXCLUDED.second_start_time,second_end_time=EXCLUDED.second_end_time,is_active=EXCLUDED.is_active,timezone=EXCLUDED.timezone,updated_at=now()`, [organizationId, locationId, hour.weekday, hour.openingTime || "00:00", hour.closingTime || "00:01", hour.secondOpeningTime || null, hour.secondClosingTime || null, hour.isOpen]);
    return parsed;
  });
}

export async function listBusinessLocationContent(organizationId: string, queueId: string) {
  const [location, hours, exceptions] = await Promise.all([
    queryTenantDatabase<Row>(organizationId, "SELECT * FROM business_locations WHERE organization_id=$1 AND queue_id=$2 LIMIT 1", [organizationId, queueId]),
    queryTenantDatabase<Row>(organizationId, "SELECT h.* FROM business_hours h JOIN business_locations l ON l.id=h.location_id AND l.organization_id=h.organization_id WHERE h.organization_id=$1 AND l.queue_id=$2 ORDER BY weekday", [organizationId, queueId]),
    queryTenantDatabase<Row>(organizationId, "SELECT e.* FROM business_special_hours e JOIN business_locations l ON l.id=e.location_id AND l.organization_id=e.organization_id WHERE e.organization_id=$1 AND l.queue_id=$2 ORDER BY calendar_date DESC", [organizationId, queueId]),
  ]);
  return { location: location.rows[0] || null, hours: hours.rows, exceptions: exceptions.rows };
}

export async function saveBusinessHourException(organizationId: string, queueId: string, input: BusinessHourExceptionInput) {
  const value = businessHourExceptionSchema.parse(input);
  return withTenantTransaction(organizationId, async (client) => {
    const location = await client.query<Row>("SELECT id FROM business_locations WHERE organization_id=$1 AND queue_id=$2", [organizationId, queueId]);
    if (!location.rowCount) throw new Error("Cadastre a unidade antes das exceções.");
    const result = await client.query<Row>(`INSERT INTO business_special_hours (organization_id,location_id,calendar_date,title,note,is_closed,start_time,end_time)
      VALUES ($1,$2,$3,$4,$4,$5,$6,$7) ON CONFLICT (organization_id,calendar_date) DO UPDATE SET location_id=EXCLUDED.location_id,title=EXCLUDED.title,note=EXCLUDED.note,is_closed=EXCLUDED.is_closed,start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,updated_at=now() RETURNING *`, [organizationId, String(location.rows[0].id), value.date, value.title, value.isClosed, value.openingTime, value.closingTime]);
    return result.rows[0];
  });
}

function promotionMap(row: Row) { return { id: String(row.id), queueId: String(row.queue_id), title: String(row.title), description: row.description ? String(row.description) : null, caption: row.caption ? String(row.caption) : null, startsAt: String(row.starts_at), expiresAt: String(row.expires_at), active: row.active !== false, archived: row.archived === true, displayOrder: Number(row.display_order || 0), media: Array.isArray(row.media) ? row.media : [], createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
export async function listQueuePromotions(organizationId: string, queueId: string) {
  const result = await queryTenantDatabase<Row>(organizationId, `SELECT p.*, COALESCE(json_agg(json_build_object('id',m.id,'url',m.media_url,'mimeType',m.mime_type,'position',m.position) ORDER BY m.position) FILTER (WHERE m.id IS NOT NULL),'[]') media FROM promotions p LEFT JOIN promotion_media m ON m.promotion_id=p.id AND m.organization_id=p.organization_id WHERE p.organization_id=$1 AND p.queue_id=$2 GROUP BY p.id ORDER BY p.display_order,p.starts_at DESC`, [organizationId, queueId]);
  return result.rows.map(promotionMap);
}
export async function getActivePromotions(organizationId: string, queueId: string, now = new Date()) {
  const result = await queryTenantDatabase<Row>(organizationId, `SELECT p.*, COALESCE(json_agg(json_build_object('id',m.id,'url',m.media_url,'mimeType',m.mime_type,'position',m.position) ORDER BY m.position) FILTER (WHERE m.id IS NOT NULL),'[]') media FROM promotions p LEFT JOIN promotion_media m ON m.promotion_id=p.id AND m.organization_id=p.organization_id WHERE p.organization_id=$1 AND p.queue_id=$2 AND p.published_at IS NOT NULL AND p.published_active=true AND p.published_archived=false AND p.starts_at <= $3 AND p.expires_at > $3 GROUP BY p.id ORDER BY p.display_order,p.starts_at DESC`, [organizationId, queueId, now.toISOString()]);
  return result.rows.map(promotionMap);
}
export async function createQueuePromotion(organizationId: string, queueId: string, userId: string, input: PromotionInput, media: { url: string; publicId: string; mimeType: string; bytes: number }) {
  const value = promotionInputSchema.parse(input);
  const result = await withTenantTransaction(organizationId, async (client) => {
    const queue = await client.query("SELECT id FROM queues WHERE organization_id=$1 AND id=$2", [organizationId, queueId]); if (!queue.rowCount) throw new Error("Fila não encontrada.");
    const promotion = await client.query<Row>(`INSERT INTO promotions (organization_id,queue_id,title,description,caption,status,starts_at,expires_at,active,archived,display_order,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,false,$9,$10,$10) RETURNING *`, [organizationId, queueId, value.title, value.description || null, value.caption || null, value.startsAt, value.expiresAt, value.active, value.displayOrder, userId]);
    await client.query("INSERT INTO promotion_media (organization_id,promotion_id,media_url,cloudinary_public_id,mime_type,bytes,position) VALUES ($1,$2,$3,$4,$5,$6,0)", [organizationId, String(promotion.rows[0].id), media.url, media.publicId, media.mimeType, media.bytes]);
    return promotion.rows[0];
  });
  logger.info({ organizationId, queueId, promotionId: result.id }, "queue_promotion_created");
  return result;
}
export async function archiveQueuePromotion(organizationId: string, queueId: string, promotionId: string, userId: string) {
  const result = await queryTenantDatabase<Row>(organizationId, "UPDATE promotions SET archived=true,archived_at=now(),active=false,updated_by=$4,updated_at=now() WHERE organization_id=$1 AND queue_id=$2 AND id=$3 AND archived=false RETURNING *", [organizationId, queueId, promotionId, userId]);
  return result.rows[0] || null;
}

/** Atualiza somente o rascunho de conteúdo; o bot continua lendo os campos
 * published_* até uma nova publicação da fila. */
export async function updateQueuePromotion(organizationId: string, queueId: string, promotionId: string, userId: string, input: Partial<PromotionInput>) {
  const current = await queryTenantDatabase<Row>(organizationId, "SELECT * FROM promotions WHERE organization_id=$1 AND queue_id=$2 AND id=$3 AND archived=false LIMIT 1", [organizationId, queueId, promotionId]);
  if (!current.rowCount) return null;
  const row = current.rows[0];
  const value = promotionInputSchema.parse({
    title: input.title ?? String(row.title), description: input.description === undefined ? row.description : input.description,
    caption: input.caption === undefined ? row.caption : input.caption, startsAt: input.startsAt ?? new Date(String(row.starts_at)).toISOString(),
    expiresAt: input.expiresAt ?? new Date(String(row.expires_at)).toISOString(), active: input.active ?? (row.active !== false),
    displayOrder: input.displayOrder ?? Number(row.display_order || 0), handoffEnabled: input.handoffEnabled ?? true, afterSendMessage: input.afterSendMessage,
  });
  const result = await queryTenantDatabase<Row>(organizationId, "UPDATE promotions SET title=$4,description=$5,caption=$6,starts_at=$7,expires_at=$8,active=$9,display_order=$10,updated_by=$11,updated_at=now() WHERE organization_id=$1 AND queue_id=$2 AND id=$3 RETURNING *", [organizationId, queueId, promotionId, value.title, value.description || null, value.caption || null, value.startsAt, value.expiresAt, value.active, value.displayOrder, userId]);
  return result.rows[0] || null;
}
