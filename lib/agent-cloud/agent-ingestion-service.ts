import type { PoolClient } from "pg";
import { mavoConfig } from "@/lib/config/mavo-config";
import { assertRecordsChecksum } from "@/lib/agent-cloud/agent-idempotency";
import { databasePoolForAgentIngestion, recordAgentAudit } from "@/lib/agent-cloud/agent-repository";
import type {
  AgentSyncPayload,
  InventoryEntriesPayload,
  ProductSalesPayload,
  SalesDailyPayload,
} from "@/lib/agent-cloud/agent-payload-schemas";
import type {
  AgentContext,
  AgentDataType,
  AgentSyncResult,
} from "@/lib/agent-cloud/types";

type ExistingBatch = {
  id: string;
  checksum: string;
  data_type: AgentDataType;
  item_count: number;
  processed_count: number;
  rejected_count: number;
};

async function insertSalesDaily(
  client: PoolClient,
  context: AgentContext,
  batchId: string,
  payload: SalesDailyPayload,
): Promise<void> {
  await client.query(
    `INSERT INTO business_sales_daily (
       organization_id, sale_date, gross_total, net_total, discount_total,
       cancelled_total, sales_count, items_quantity, average_ticket,
       source_updated_at, sync_batch_id
     )
     SELECT $1, item.sale_date, item.gross_total, item.net_total,
            item.discount_total, item.cancelled_total, item.sales_count,
            item.items_quantity, item.average_ticket, item.source_updated_at, $2
       FROM jsonb_to_recordset($3::jsonb) AS item(
         sale_date date, gross_total numeric, net_total numeric,
         discount_total numeric, cancelled_total numeric, sales_count integer,
         items_quantity numeric, average_ticket numeric,
         source_updated_at timestamptz
       )
     ON CONFLICT (organization_id, sale_date)
     DO UPDATE SET gross_total = EXCLUDED.gross_total,
                   net_total = EXCLUDED.net_total,
                   discount_total = EXCLUDED.discount_total,
                   cancelled_total = EXCLUDED.cancelled_total,
                   sales_count = EXCLUDED.sales_count,
                   items_quantity = EXCLUDED.items_quantity,
                   average_ticket = EXCLUDED.average_ticket,
                   source_updated_at = EXCLUDED.source_updated_at,
                   sync_batch_id = EXCLUDED.sync_batch_id,
                   updated_at = now()
     WHERE EXCLUDED.source_updated_at >= business_sales_daily.source_updated_at`,
    [
      context.organizationId,
      batchId,
      JSON.stringify(
        payload.records.map((record) => ({
          sale_date: record.saleDate,
          gross_total: record.grossTotal,
          net_total: record.netTotal,
          discount_total: record.discountTotal,
          cancelled_total: record.cancelledTotal,
          sales_count: record.salesCount,
          items_quantity: record.itemsQuantity,
          average_ticket: record.averageTicket,
          source_updated_at: record.sourceUpdatedAt,
        })),
      ),
    ],
  );
}

async function insertProductSales(
  client: PoolClient,
  context: AgentContext,
  batchId: string,
  payload: ProductSalesPayload,
): Promise<void> {
  await client.query(
    `INSERT INTO business_product_sales_daily (
       organization_id, sale_date, product_id, sku, product_name, quantity,
       gross_total, net_total, source_updated_at, sync_batch_id
     )
     SELECT $1, item.sale_date, item.product_id, item.sku, item.product_name,
            item.quantity, item.gross_total, item.net_total,
            item.source_updated_at, $2
       FROM jsonb_to_recordset($3::jsonb) AS item(
         sale_date date, product_id text, sku text, product_name text,
         quantity numeric, gross_total numeric, net_total numeric,
         source_updated_at timestamptz
       )
     ON CONFLICT (organization_id, sale_date, product_id)
     DO UPDATE SET sku = EXCLUDED.sku,
                   product_name = EXCLUDED.product_name,
                   quantity = EXCLUDED.quantity,
                   gross_total = EXCLUDED.gross_total,
                   net_total = EXCLUDED.net_total,
                   source_updated_at = EXCLUDED.source_updated_at,
                   sync_batch_id = EXCLUDED.sync_batch_id,
                   updated_at = now()
     WHERE EXCLUDED.source_updated_at >= business_product_sales_daily.source_updated_at`,
    [
      context.organizationId,
      batchId,
      JSON.stringify(
        payload.records.map((record) => ({
          sale_date: record.saleDate,
          product_id: record.productId,
          sku: record.sku || null,
          product_name: record.productName,
          quantity: record.quantity,
          gross_total: record.grossTotal,
          net_total: record.netTotal,
          source_updated_at: record.sourceUpdatedAt,
        })),
      ),
    ],
  );
}

async function insertInventoryEntries(
  client: PoolClient,
  context: AgentContext,
  batchId: string,
  payload: InventoryEntriesPayload,
): Promise<void> {
  await client.query(
    `INSERT INTO business_inventory_entries_daily (
       organization_id, entry_date, product_id, sku, product_name,
       quantity_entered, total_cost, source_updated_at, sync_batch_id
     )
     SELECT $1, item.entry_date, item.product_id, item.sku, item.product_name,
            item.quantity_entered, item.total_cost, item.source_updated_at, $2
       FROM jsonb_to_recordset($3::jsonb) AS item(
         entry_date date, product_id text, sku text, product_name text,
         quantity_entered numeric, total_cost numeric,
         source_updated_at timestamptz
       )
     ON CONFLICT (organization_id, entry_date, product_id)
     DO UPDATE SET sku = EXCLUDED.sku,
                   product_name = EXCLUDED.product_name,
                   quantity_entered = EXCLUDED.quantity_entered,
                   total_cost = EXCLUDED.total_cost,
                   source_updated_at = EXCLUDED.source_updated_at,
                   sync_batch_id = EXCLUDED.sync_batch_id,
                   updated_at = now()
     WHERE EXCLUDED.source_updated_at >= business_inventory_entries_daily.source_updated_at`,
    [
      context.organizationId,
      batchId,
      JSON.stringify(
        payload.records.map((record) => ({
          entry_date: record.entryDate,
          product_id: record.productId,
          sku: record.sku || null,
          product_name: record.productName,
          quantity_entered: record.quantityEntered,
          total_cost: record.totalCost ?? null,
          source_updated_at: record.sourceUpdatedAt,
        })),
      ),
    ],
  );
}

function resultFor(
  payload: AgentSyncPayload,
  duplicate: boolean,
  processedRecords: number,
  rejectedRecords: number,
): AgentSyncResult {
  return {
    accepted: true,
    batchId: payload.batchId,
    duplicate,
    receivedRecords: payload.records.length,
    processedRecords,
    rejectedRecords,
    serverTime: new Date().toISOString(),
    nextSyncAfterSeconds: mavoConfig.agentNextSyncSeconds,
  };
}

export async function ingestAgentBatch(input: {
  context: AgentContext;
  dataType: AgentDataType;
  payload: AgentSyncPayload;
  idempotencyKey: string;
}): Promise<AgentSyncResult> {
  if (input.idempotencyKey !== input.payload.batchId) {
    const error = new Error("Idempotency-Key deve ser igual ao batchId");
    Object.assign(error, { code: "IDEMPOTENCY_KEY_MISMATCH", status: 422 });
    throw error;
  }
  assertRecordsChecksum(input.payload.records, input.payload.checksum);
  const startedAt = Date.now();
  const pool = databasePoolForAgentIngestion();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [
      input.context.organizationId,
    ]);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO agent_sync_batches (
         id, organization_id, agent_id, batch_id, data_type, payload_version,
         agent_version, source_timezone, range_from, range_to,
         source_generated_at, status, checksum, item_count
       )
       VALUES (
         gen_random_uuid()::text, $1, $2, $3::uuid, $4, $5, $6, $7,
         $8::date, $9::date, $10::timestamptz, 'processing', $11, $12
       )
       ON CONFLICT (agent_id, batch_id) DO NOTHING
       RETURNING id`,
      [
        input.context.organizationId,
        input.context.agentId,
        input.payload.batchId,
        input.dataType,
        input.payload.schemaVersion,
        input.payload.agentVersion,
        input.payload.sourceTimezone,
        input.payload.range.from,
        input.payload.range.to,
        input.payload.generatedAt,
        input.payload.checksum,
        input.payload.records.length,
      ],
    );

    if (!inserted.rows[0]) {
      const existing = await client.query<ExistingBatch>(
        `SELECT id, checksum, data_type, item_count, processed_count, rejected_count
           FROM agent_sync_batches
          WHERE agent_id = $1 AND batch_id = $2::uuid`,
        [input.context.agentId, input.payload.batchId],
      );
      const row = existing.rows[0];
      if (!row || row.checksum !== input.payload.checksum || row.data_type !== input.dataType) {
        const error = new Error("batchId já utilizado com conteúdo diferente");
        Object.assign(error, { code: "BATCH_CONFLICT", status: 409 });
        throw error;
      }
      await client.query("COMMIT");
      return resultFor(
        input.payload,
        true,
        row.processed_count,
        row.rejected_count,
      );
    }

    const internalBatchId = inserted.rows[0].id;
    if (input.dataType === "sales_daily") {
      await insertSalesDaily(
        client,
        input.context,
        internalBatchId,
        input.payload as SalesDailyPayload,
      );
    } else if (input.dataType === "product_sales_daily") {
      await insertProductSales(
        client,
        input.context,
        internalBatchId,
        input.payload as ProductSalesPayload,
      );
    } else {
      await insertInventoryEntries(
        client,
        input.context,
        internalBatchId,
        input.payload as InventoryEntriesPayload,
      );
    }

    await client.query(
      `UPDATE agent_sync_batches
          SET status = 'processed', processed_at = now(),
              processed_count = item_count, rejected_count = 0
        WHERE id = $1 AND organization_id = $2`,
      [internalBatchId, input.context.organizationId],
    );
    await client.query(
      `UPDATE agent_installations
          SET status = 'online', agent_version = $3, schema_version = $4,
              last_sync_at = now(), last_ip = $5::inet,
              last_error_code = NULL, updated_at = now()
        WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL`,
      [
        input.context.agentId,
        input.context.organizationId,
        input.payload.agentVersion,
        input.payload.schemaVersion,
        input.context.sourceIp,
      ],
    );
    await client.query("COMMIT");
    await recordAgentAudit({
      context: input.context,
      organizationId: input.context.organizationId,
      batchId: input.payload.batchId,
      requestId: input.context.requestId,
      eventType: `sync_${input.dataType}`,
      status: "success",
      durationMs: Date.now() - startedAt,
      metadata: { recordCount: input.payload.records.length },
    });
    return resultFor(input.payload, false, input.payload.records.length, 0);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await recordAgentAudit({
      context: input.context,
      organizationId: input.context.organizationId,
      batchId: input.payload.batchId,
      requestId: input.context.requestId,
      eventType: `sync_${input.dataType}`,
      status: "failed",
      errorCode:
        typeof (error as { code?: unknown }).code === "string"
          ? String((error as { code: string }).code)
          : "INGESTION_FAILED",
      durationMs: Date.now() - startedAt,
    }).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
