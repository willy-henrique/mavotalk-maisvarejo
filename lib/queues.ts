import { Queue } from "bullmq";

const connection = process.env.REDIS_URL ? { url: process.env.REDIS_URL } : null;

export const webhookQueue =
  connection &&
  new Queue("webhook-events", {
    connection,
  });

export const slaQueue =
  connection &&
  new Queue("sla-events", {
    connection,
  });

export async function enqueueWebhookEvent(name: string, data: Record<string, unknown>) {
  if (!webhookQueue) return;
  await webhookQueue.add(name, data, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });
}

export async function enqueueSlaCheck(conversationId: string, delayMs: number) {
  if (!slaQueue) return;
  await slaQueue.add("sla-check", { conversationId }, { delay: delayMs, removeOnComplete: true });
}

