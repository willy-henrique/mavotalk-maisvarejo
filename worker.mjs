import "dotenv/config";
import { pathToFileURL } from "node:url";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { v2 as cloudinary } from "cloudinary";
import runtimeEnvironment from "./lib/config/runtime-env.cjs";
import { processFirstResponseSlaCheck } from "./lib/sla-worker.mjs";

function log(level, fields) {
  const output = JSON.stringify({
    timestamp: new Date().toISOString(),
    service: "mavo-talk-worker",
    ...fields,
  });
  if (level === "error") console.error(output);
  else console.log(output);
}

// Pode ser executada isoladamente em validações operacionais. A condição de
// atualização é idempotente: uma segunda execução não altera promoções já
// marcadas como expiradas.
export async function expirePromotions() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_RUNTIME || process.env.DATABASE_URL, ssl: process.env.PG_SSL === "false" ? undefined : process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined });
  try {
    const organizations = await pool.query("SELECT id FROM organizations");
    let expired = 0;
    for (const organization of organizations.rows) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.organization_id',$1,true)", [String(organization.id)]);
        const result = await client.query("UPDATE promotions SET status='expired',updated_at=now() WHERE organization_id=$1 AND archived=false AND active=true AND expires_at <= now() AND status <> 'expired'", [String(organization.id)]);
        expired += result.rowCount || 0;
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
    }
    if (expired) log("info", { event: "promotions_expired", count: expired });
    return expired;
  } finally { await pool.end(); }
}

/**
 * Sobe os workers BullMQ e devolve um handle de encerramento.
 *
 * No plano gratuito do Render não existe Background Worker, então o processo web
 * chama esta função com `standalone: false` e cuida do shutdown junto com o HTTP.
 */
export function startWorkers({ standalone = false } = {}) {
  runtimeEnvironment.validateWorkerEnvironment();

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    log("error", { event: "worker_start_failed", code: "REDIS_URL_MISSING" });
    if (standalone) process.exit(1);
    return null;
  }

  const environment =
    process.env.MAVO_QUEUE_ENV || process.env.NODE_ENV || "development";
  const queueName = (name) => `mavo-talk-${environment}-${name}`;
  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    connectTimeout: 10_000,
    enableReadyCheck: true,
  });

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (cloudName && apiKey && apiSecret) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
    });
  }

  // Segunda barreira de expiração: a leitura do bot também compara as datas,
  // mas este job mantém o estado operacional e os cards sincronizados.
  void expirePromotions().catch((error) => log("error", { event: "promotions_expiration_failed", error_code: error?.name || "EXPIRATION_FAILED" }));
  const promotionExpirationTimer = setInterval(() => void expirePromotions().catch((error) => log("error", { event: "promotions_expiration_failed", error_code: error?.name || "EXPIRATION_FAILED" })), 5 * 60_000);
  promotionExpirationTimer.unref();

  function worker(name, processor) {
    const instance = new Worker(queueName(name), processor, {
      connection,
      concurrency: Number(process.env.WORKER_CONCURRENCY || 5),
      lockDuration: 30_000,
    });
    instance.on("completed", (job) => {
      log("info", {
        event: "job_completed",
        queue: name,
        job_id: job.id,
        job_name: job.name,
      });
    });
    instance.on("failed", (job, error) => {
      log("error", {
        event: "job_failed",
        queue: name,
        job_id: job?.id,
        job_name: job?.name,
        attempts_made: job?.attemptsMade,
        error_code: error?.name || "JOB_FAILED",
      });
    });
    return instance;
  }

  const workers = [
    worker("sla", async (job) => {
      if (job.name !== "sla-check") return;
      const outcome = await processFirstResponseSlaCheck({
        organizationId: job.data?.organizationId,
        conversationId: job.data?.conversationId,
      });
      log("info", {
        event: outcome.breached ? "sla_first_response_breached" : "sla_check_ignored",
        organization_id: job.data?.organizationId,
        conversation_id: job.data?.conversationId,
        ticket_id: outcome.ticketId,
      });
    }),
    worker("media-cleanup", async (job) => {
      if (job.name !== "delete-resources" || !Array.isArray(job.data?.publicIds)) {
        return;
      }
      if (!cloudName || !apiKey || !apiSecret) {
        throw new Error("CLOUDINARY_NOT_CONFIGURED");
      }
      if (job.data.publicIds.length) {
        await cloudinary.api.delete_resources(job.data.publicIds, {
          resource_type: "image",
        });
      }
    }),
    worker("order-notifications", async (job) => {
      if (job.name !== "send-order-notification" || !job.data?.organizationId || !job.data?.outboxId) return;
      const { Pool } = await import("pg");
      const pool = new Pool({ connectionString: process.env.DATABASE_URL_RUNTIME || process.env.DATABASE_URL, ssl: process.env.PG_SSL === "false" ? undefined : process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.organization_id',$1,true)",[String(job.data.organizationId)]);
        const claimed = await client.query(`UPDATE notification_outbox SET status='processing',processing_at=now(),attempts=attempts+1,updated_at=now() WHERE id=$1 AND organization_id=$2 AND status IN ('pending','failed') AND attempts < max_attempts RETURNING *`, [String(job.data.outboxId), String(job.data.organizationId)]);
        if (!claimed.rowCount) { await client.query("COMMIT"); return; }
        const notification = claimed.rows[0];
        await client.query("COMMIT");
        if (String(process.env.WILLTALK_DRY_RUN_WHATSAPP || "").toLowerCase() !== "true") {
          if ((process.env.WHATSAPP_PROVIDER || "twilio") !== "twilio" || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_WHATSAPP_NUMBER) throw new Error("NOTIFICATION_CHANNEL_NOT_CONFIGURED");
          const twilioModule = await import("twilio");
          const twilio = twilioModule.default;
          await twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN).messages.create({ from:process.env.TWILIO_WHATSAPP_NUMBER,to:String(notification.destination),body:String(notification.message_body) });
        }
        await client.query("BEGIN"); await client.query("SELECT set_config('app.organization_id',$1,true)",[String(job.data.organizationId)]);
        await client.query("UPDATE notification_outbox SET status='sent',sent_at=now(),updated_at=now(),last_error_code=NULL WHERE id=$1 AND organization_id=$2",[String(job.data.outboxId),String(job.data.organizationId)]); await client.query("COMMIT");
        log("info",{event:"order_notification_sent",organization_id:job.data.organizationId,outbox_id:job.data.outboxId});
      } catch (error) {
        await client.query("ROLLBACK").catch(()=>undefined);
        await client.query("BEGIN").catch(()=>undefined); await client.query("SELECT set_config('app.organization_id',$1,true)",[String(job.data.organizationId)]).catch(()=>undefined);
        await client.query("UPDATE notification_outbox SET status=CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,last_error_code=$3,last_error_at=now(),updated_at=now() WHERE id=$1 AND organization_id=$2",[String(job.data.outboxId),String(job.data.organizationId),String(error?.message||"SEND_FAILED").slice(0,80)]).catch(()=>undefined); await client.query("COMMIT").catch(()=>undefined);
        throw error;
      } finally { client.release(); await pool.end(); }
    }),
  ];

  log("info", {
    event: "workers_started",
    mode: standalone ? "standalone" : "inline",
    queues: ["sla", "media-cleanup", "order-notifications"].map(queueName),
  });

  let closed = false;
  return {
    workers,
    connection,
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(promotionExpirationTimer);
      await Promise.all(workers.map((item) => item.close().catch(() => undefined)));
      await connection.quit().catch(() => connection.disconnect());
    },
  };
}

function runStandalone() {
  const handle = startWorkers({ standalone: true });
  if (!handle) return;

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", { event: "worker_shutdown_started", signal });
    const deadline = setTimeout(() => process.exit(1), 15_000);
    deadline.unref();
    await handle.close();
    clearTimeout(deadline);
    log("info", { event: "worker_shutdown_complete", signal });
    process.exit(0);
  }

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStandalone();
}
