import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { v2 as cloudinary } from "cloudinary";
import runtimeEnvironment from "./lib/config/runtime-env.cjs";

runtimeEnvironment.validateWorkerEnvironment();

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error(
    JSON.stringify({ event: "worker_start_failed", code: "REDIS_URL_MISSING" }),
  );
  process.exit(1);
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

function log(level, fields) {
  const output = JSON.stringify({
    timestamp: new Date().toISOString(),
    service: "mavo-talk-worker",
    ...fields,
  });
  if (level === "error") console.error(output);
  else console.log(output);
}

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
    log("info", {
      event: "sla_check",
      conversation_id: job.data?.conversationId,
    });
  }),
  worker("webhooks", async (job) => {
    log("info", {
      event: "webhook_job",
      job_name: job.name,
      organization_id: job.data?.organizationId,
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
  worker("agent-sync", async (job) => {
    log("info", {
      event: "agent_sync_job",
      job_name: job.name,
      agent_id: job.data?.agentId,
      batch_id: job.data?.batchId,
    });
  }),
];

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", { event: "worker_shutdown_started", signal });
  const deadline = setTimeout(() => process.exit(1), 15_000);
  deadline.unref();
  await Promise.all(workers.map((item) => item.close()));
  await connection.quit().catch(() => connection.disconnect());
  clearTimeout(deadline);
  log("info", { event: "worker_shutdown_complete", signal });
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
log("info", {
  event: "workers_started",
  queues: ["sla", "webhooks", "media-cleanup", "agent-sync"].map(queueName),
});
