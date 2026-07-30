import { randomUUID } from "node:crypto";
import { queryTenantDatabase, withTenantTransaction } from "@/lib/db";
import { logger } from "@/lib/logger";
import { enqueueOrderNotification } from "@/lib/queues";

export type PromotionStatus = "draft" | "scheduled" | "active" | "expired" | "disabled";
export type OrderStatus = "received" | "confirmed" | "preparing" | "ready" | "dispatched" | "cancelled" | "delivered";

export type PromotionInput = { title: string; description?: string | null; startsAt: string; expiresAt: string; status?: "draft" | "scheduled" | "active" };
export type DeliverySettingsInput = { isActive: boolean; minMinutes: number; maxMinutes: number; defaultMinutes?: number | null; additionalMarginMinutes?: number; timezone: string; dispatchMessage?: string | null; schedule: Array<{ weekday: number; startTime: string; endTime: string; isActive: boolean }> };

const promotionStatuses = new Set<PromotionStatus>(["draft", "scheduled", "active", "expired", "disabled"]);
const orderStatuses = new Set<OrderStatus>(["received", "confirmed", "preparing", "ready", "dispatched", "cancelled", "delivered"]);
const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
  received: ["confirmed", "cancelled"], confirmed: ["preparing", "cancelled"], preparing: ["ready", "cancelled"], ready: ["dispatched", "cancelled"], dispatched: ["delivered", "cancelled"], delivered: [], cancelled: [],
};

function toIso(value: string) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw new Error("Data inválida"); return date.toISOString(); }
function normalizedText(value: string | null | undefined, max: number) { const next = String(value || "").trim().replace(/\s+/g, " "); return next ? next.slice(0, max) : null; }
function promotionStatus(row: Record<string, unknown>, now = new Date()): PromotionStatus {
  const current = String(row.status || "draft") as PromotionStatus;
  if (current === "disabled" || current === "draft") return current;
  const startsAt = new Date(String(row.starts_at)); const expiresAt = new Date(String(row.expires_at));
  if (expiresAt <= now) return "expired";
  if (startsAt > now) return "scheduled";
  return "active";
}
function mapPromotion(row: Record<string, unknown>) { return { id:String(row.id), title:String(row.title), description:row.description ? String(row.description):null, status:promotionStatus(row), startsAt:new Date(String(row.starts_at)).toISOString(), expiresAt:new Date(String(row.expires_at)).toISOString(), createdAt:String(row.created_at), updatedAt:String(row.updated_at), media:Array.isArray(row.media)?row.media:[] }; }

export async function listPromotions(organizationId: string, options: { status?: PromotionStatus; page?: number; pageSize?: number; includeExpired?: boolean } = {}) {
  const page = Math.max(1, options.page || 1); const pageSize = Math.min(100, Math.max(1, options.pageSize || 25));
  const status = options.status && promotionStatuses.has(options.status) ? options.status : undefined;
  const result = await queryTenantDatabase<Record<string, unknown>>(organizationId, `
    SELECT p.*, COALESCE(json_agg(json_build_object('id',pm.id,'url',pm.media_url,'mimeType',pm.mime_type,'position',pm.position) ORDER BY pm.position) FILTER (WHERE pm.id IS NOT NULL), '[]') AS media
    FROM promotions p LEFT JOIN promotion_media pm ON pm.promotion_id=p.id AND pm.organization_id=p.organization_id
    WHERE p.organization_id=$1 ${status ? "AND p.status=$2" : ""}
    GROUP BY p.id ORDER BY p.starts_at DESC LIMIT $${status ? 3 : 2} OFFSET $${status ? 4 : 3}`,
    status ? [organizationId, status, pageSize, (page-1)*pageSize] : [organizationId, pageSize, (page-1)*pageSize]);
  return result.rows.map(mapPromotion);
}

export async function listValidPromotions(organizationId: string, now = new Date()) {
  const result = await queryTenantDatabase<Record<string, unknown>>(organizationId, `
    SELECT p.*, COALESCE(json_agg(json_build_object('id',pm.id,'url',pm.media_url,'mimeType',pm.mime_type,'position',pm.position) ORDER BY pm.position) FILTER (WHERE pm.id IS NOT NULL), '[]') AS media
    FROM promotions p LEFT JOIN promotion_media pm ON pm.promotion_id=p.id AND pm.organization_id=p.organization_id
    WHERE p.organization_id=$1 AND p.status='active' AND p.starts_at <= $2 AND p.expires_at > $2
    GROUP BY p.id ORDER BY p.starts_at DESC`, [organizationId, now.toISOString()]);
  return result.rows.map(mapPromotion);
}

export async function createPromotion(organizationId: string, userId: string, input: PromotionInput) {
  const startsAt = toIso(input.startsAt); const expiresAt = toIso(input.expiresAt); if (new Date(expiresAt) <= new Date(startsAt)) throw new Error("A expiração deve ser posterior ao início");
  const requested = input.status || "draft";
  const status = requested === "active" && new Date(startsAt) > new Date() ? "scheduled" : requested;
  const result = await queryTenantDatabase<Record<string, unknown>>(organizationId, `INSERT INTO promotions (organization_id,title,description,status,starts_at,expires_at,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`, [organizationId, normalizedText(input.title,180), normalizedText(input.description,4000), status, startsAt, expiresAt, userId]);
  logger.info({ organizationId, userId, promotionId:result.rows[0]?.id }, "promotion_created");
  return mapPromotion({ ...result.rows[0], media: [] });
}

export async function updatePromotion(organizationId: string, id: string, userId: string, input: Partial<PromotionInput>) {
  return withTenantTransaction(organizationId, async (client) => {
    const current = await client.query<Record<string, unknown>>("SELECT * FROM promotions WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId,id]);
    if (!current.rowCount) return null;
    const row=current.rows[0]; const startsAt=input.startsAt?toIso(input.startsAt):String(row.starts_at); const expiresAt=input.expiresAt?toIso(input.expiresAt):String(row.expires_at);
    if(new Date(expiresAt)<=new Date(startsAt)) throw new Error("A expiração deve ser posterior ao início");
    const requested=input.status || String(row.status); const status=requested === "active" && new Date(startsAt)>new Date()?"scheduled":requested;
    const changed=await client.query<Record<string, unknown>>(`UPDATE promotions SET title=$3,description=$4,status=$5,starts_at=$6,expires_at=$7,updated_by=$8,updated_at=now(),disabled_at=CASE WHEN $5='disabled' THEN now() ELSE NULL END WHERE organization_id=$1 AND id=$2 RETURNING *`, [organizationId,id,input.title?normalizedText(input.title,180):row.title,input.description===undefined?row.description:normalizedText(input.description,4000),status,startsAt,expiresAt,userId]);
    return mapPromotion({ ...changed.rows[0], media: [] });
  });
}

export async function duplicatePromotion(organizationId:string, id:string, userId:string) {
  const source=await queryTenantDatabase<Record<string,unknown>>(organizationId,"SELECT * FROM promotions WHERE organization_id=$1 AND id=$2",[organizationId,id]); if(!source.rowCount)return null;
  const row=source.rows[0]; return createPromotion(organizationId,userId,{title:`${String(row.title)} (cópia)`.slice(0,180),description:row.description?String(row.description):null,startsAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),status:"draft"});
}

export async function addPromotionMedia(organizationId:string, promotionId:string, media:{url:string;publicId?:string|null;mimeType:string;bytes:number}) {
  const result=await queryTenantDatabase<Record<string,unknown>>(organizationId,"INSERT INTO promotion_media (organization_id,promotion_id,media_url,cloudinary_public_id,mime_type,bytes,position) SELECT $1,$2,$3,$4,$5,$6,COALESCE(MAX(position)+1,0) FROM promotion_media WHERE organization_id=$1 AND promotion_id=$2 RETURNING *",[organizationId,promotionId,media.url,media.publicId||null,media.mimeType,media.bytes]); return result.rows[0]||null;
}

export async function getDeliverySettings(organizationId:string) {
  const [settings,schedule]=await Promise.all([queryTenantDatabase<Record<string,unknown>>(organizationId,"SELECT * FROM delivery_settings WHERE organization_id=$1",[organizationId]),queryTenantDatabase<Record<string,unknown>>(organizationId,"SELECT weekday,start_time,end_time,is_active FROM delivery_schedule WHERE organization_id=$1 ORDER BY weekday",[organizationId])]);
  const row=settings.rows[0]; return { isActive:row?.is_active===true,minMinutes:Number(row?.min_minutes||30),maxMinutes:Number(row?.max_minutes||60),defaultMinutes:row?.default_minutes?Number(row.default_minutes):null,additionalMarginMinutes:Number(row?.additional_margin_minutes||0),timezone:String(row?.timezone||"America/Sao_Paulo"),dispatchMessage:row?.dispatch_message?String(row.dispatch_message):null,schedule:schedule.rows.map(x=>({weekday:Number(x.weekday),startTime:String(x.start_time),endTime:String(x.end_time),isActive:x.is_active!==false})) };
}

export async function saveDeliverySettings(organizationId:string, input:DeliverySettingsInput) {
  if(input.minMinutes>input.maxMinutes)throw new Error("O tempo mínimo não pode ser maior que o máximo");
  return withTenantTransaction(organizationId,async client=>{await client.query(`INSERT INTO delivery_settings (organization_id,is_active,min_minutes,max_minutes,default_minutes,additional_margin_minutes,timezone,dispatch_message) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (organization_id) DO UPDATE SET is_active=EXCLUDED.is_active,min_minutes=EXCLUDED.min_minutes,max_minutes=EXCLUDED.max_minutes,default_minutes=EXCLUDED.default_minutes,additional_margin_minutes=EXCLUDED.additional_margin_minutes,timezone=EXCLUDED.timezone,dispatch_message=EXCLUDED.dispatch_message,updated_at=now()`,[organizationId,input.isActive,input.minMinutes,input.maxMinutes,input.defaultMinutes||null,input.additionalMarginMinutes||0,input.timezone,normalizedText(input.dispatchMessage,1000)]); await client.query("DELETE FROM delivery_schedule WHERE organization_id=$1",[organizationId]); for(const item of input.schedule) await client.query("INSERT INTO delivery_schedule (organization_id,weekday,start_time,end_time,is_active) VALUES ($1,$2,$3,$4,$5)",[organizationId,item.weekday,item.startTime,item.endTime,item.isActive]); return input;});
}

export function deliveryEstimate(settings:Awaited<ReturnType<typeof getDeliverySettings>>, orderedAt=new Date()) { if(!settings.isActive)return null; const min=settings.minMinutes+settings.additionalMarginMinutes; const max=settings.maxMinutes+settings.additionalMarginMinutes; return { orderedAt:orderedAt.toISOString(),minMinutes:min,maxMinutes:max,startAt:new Date(orderedAt.getTime()+min*60000).toISOString(),endAt:new Date(orderedAt.getTime()+max*60000).toISOString() }; }

export async function listOrders(organizationId:string, filters:{status?:OrderStatus;query?:string;page?:number;pageSize?:number}={}) { const page=Math.max(1,filters.page||1), size=Math.min(100,Math.max(1,filters.pageSize||25)); const where=["o.organization_id=$1"],values:unknown[]=[organizationId]; if(filters.status&&orderStatuses.has(filters.status)){values.push(filters.status);where.push(`o.delivery_status=$${values.length}`)} if(filters.query){values.push(`%${filters.query.trim()}%`);where.push(`(o.order_number ILIKE $${values.length} OR c.name ILIKE $${values.length} OR c.phone_number ILIKE $${values.length})`)} values.push(size,(page-1)*size); const r=await queryTenantDatabase<Record<string,unknown>>(organizationId,`SELECT o.*,c.name AS contact_name,c.phone_number FROM orders o LEFT JOIN contacts c ON c.id=o.contact_id AND c.organization_id=o.organization_id WHERE ${where.join(" AND ")} ORDER BY o.ordered_at DESC LIMIT $${values.length-1} OFFSET $${values.length}` ,values); return r.rows.map(row=>({id:String(row.id),number:String(row.order_number),status:String(row.delivery_status),orderedAt:String(row.ordered_at),estimatedStartAt:row.estimated_start_at?String(row.estimated_start_at):null,estimatedEndAt:row.estimated_end_at?String(row.estimated_end_at):null,dispatchedAt:row.dispatched_at?String(row.dispatched_at):null,contact:{name:row.contact_name?String(row.contact_name):null,phone:row.phone_number?String(row.phone_number):null}})); }

export async function createOrder(organizationId:string, userId:string, input:{orderNumber:string;contactId?:string|null;conversationId?:string|null;notes?:string|null}) {
  const settings=await getDeliverySettings(organizationId); const estimate=deliveryEstimate(settings); const orderNumber=normalizedText(input.orderNumber,100); if(!orderNumber)throw new Error("Número do pedido é obrigatório");
  return withTenantTransaction(organizationId,async client=>{const created=await client.query<Record<string,unknown>>(`INSERT INTO orders (organization_id,contact_id,conversation_id,order_number,responsible_user_id,estimated_min_minutes,estimated_max_minutes,estimated_start_at,estimated_end_at,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[organizationId,input.contactId||null,input.conversationId||null,orderNumber,userId,estimate?.minMinutes||null,estimate?.maxMinutes||null,estimate?.startAt||null,estimate?.endAt||null,normalizedText(input.notes,4000)]); const order=created.rows[0]; await client.query("INSERT INTO order_status_history (organization_id,order_id,next_status,changed_by,origin) VALUES ($1,$2,'received',$3,'panel')",[organizationId,order.id,userId]); return order;});
}

export async function changeOrderStatus(organizationId:string, orderId:string, userId:string, next:OrderStatus, origin="panel") {
  if(!orderStatuses.has(next)) throw new Error("Status inválido");
  const outcome = await withTenantTransaction(organizationId,async client=>{const result=await client.query<Record<string,unknown>>("SELECT o.*,c.phone_number,c.name AS contact_name FROM orders o LEFT JOIN contacts c ON c.id=o.contact_id AND c.organization_id=o.organization_id WHERE o.organization_id=$1 AND o.id=$2 FOR UPDATE",[organizationId,orderId]); if(!result.rowCount)return {kind:"not_found" as const}; const order=result.rows[0]; const previous=String(order.delivery_status) as OrderStatus; if(previous===next)return {kind:"unchanged" as const,order}; if(!allowedTransitions[previous].includes(next))throw new Error(`Transição inválida: ${previous} → ${next}`); const dispatched=next==="dispatched"?new Date().toISOString():null; const updated=await client.query<Record<string,unknown>>("UPDATE orders SET delivery_status=$3,dispatched_at=COALESCE(dispatched_at,$4::timestamptz),cancelled_at=CASE WHEN $3='cancelled' THEN now() ELSE cancelled_at END,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *",[organizationId,orderId,next,dispatched]); await client.query("INSERT INTO order_status_history (organization_id,order_id,previous_status,next_status,changed_by,origin) VALUES ($1,$2,$3,$4,$5,$6)",[organizationId,orderId,previous,next,userId,origin]); let outboxId:string|null=null; if(next==="dispatched"&&order.phone_number){const remaining=order.estimated_end_at?Math.max(0,Math.ceil((new Date(String(order.estimated_end_at)).getTime()-Date.now())/60000)):null; const message=`Seu pedido ${order.order_number} saiu para entrega.${remaining===null?"":` A previsão restante é de até ${remaining} minuto${remaining===1?"":"s"}.`} Esta é uma estimativa.`; const outbox=await client.query<{id:string}>("INSERT INTO notification_outbox (organization_id,order_id,event_type,destination,message_body,idempotency_key) VALUES ($1,$2,'order_dispatched',$3,$4,$5) ON CONFLICT (organization_id,idempotency_key) DO NOTHING RETURNING id",[organizationId,orderId,String(order.phone_number),message,`order-dispatched:${orderId}`]); outboxId=outbox.rows[0]?.id||null;} logger.info({organizationId,userId,orderId,previousStatus:previous,nextStatus:next},"order_status_changed"); return {kind:"changed" as const,order:updated.rows[0],outboxId};});
  if (outcome.kind === "changed" && outcome.outboxId) void enqueueOrderNotification(organizationId, outcome.outboxId).catch((error) => logger.warn({ organizationId, orderId, error: String(error) }, "order_notification_queue_failed"));
  return outcome;
}

export async function getOrderForCustomer(organizationId:string, orderNumber:string, phone:string) { const r=await queryTenantDatabase<Record<string,unknown>>(organizationId,"SELECT o.* FROM orders o JOIN contacts c ON c.id=o.contact_id AND c.organization_id=o.organization_id WHERE o.organization_id=$1 AND o.order_number=$2 AND regexp_replace(c.phone_number,'\\D','','g')=regexp_replace($3,'\\D','','g') LIMIT 1",[organizationId,orderNumber.trim(),phone]); return r.rows[0]||null; }
