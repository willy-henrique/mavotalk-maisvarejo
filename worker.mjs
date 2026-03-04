import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { v2 as cloudinary } from "cloudinary";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  console.log("REDIS_URL nao configurado. Worker finalizado.");
  process.exit(0);
}

const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;
if (cloudName && apiKey && apiSecret) {
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
}

new Worker(
  "sla-events",
  async (job) => {
    if (job.name !== "sla-check") return;
    console.log("SLA check job", job.data);
  },
  { connection },
);

new Worker(
  "webhook-events",
  async (job) => {
    console.log("Webhook event processed", { name: job.name, data: job.data });
  },
  { connection },
);

new Worker(
  "cloudinary-cleanup",
  async (job) => {
    if (job.name !== "delete-resources" || !job.data?.publicIds) return;
    const { publicIds } = job.data;
    if (!Array.isArray(publicIds) || publicIds.length === 0) return;
    if (!cloudName || !apiKey || !apiSecret) {
      console.log("Cloudinary nao configurado, pulando delete");
      return;
    }
    try {
      await cloudinary.api.delete_resources(publicIds, { resource_type: "image" });
      console.log("Cloudinary: removidas", publicIds.length, "imagens");
    } catch (err) {
      console.error("Cloudinary delete error:", err);
    }
  },
  { connection },
);

console.log("Workers BullMQ inicializados");
