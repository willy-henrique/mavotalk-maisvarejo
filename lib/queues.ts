import { Queue } from "bullmq";

declare global {
  // eslint-disable-next-line no-var
  var __mavoQueues: Queue[] | undefined;
}

const connection =
  process.env.NEXT_PHASE !== "phase-production-build" && process.env.REDIS_URL
    ? { url: process.env.REDIS_URL }
    : null;
const environment =
  process.env.MAVO_QUEUE_ENV || process.env.NODE_ENV || "development";
// BullMQ reserva ":" para suas chaves internas e não o aceita no nome da fila.
const queueName = (name: string) => `mavo-talk-${environment}-${name}`;
const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 1_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 604_800, count: 5_000 },
};

export const webhookQueue =
  connection &&
  new Queue(queueName("webhooks"), { connection, defaultJobOptions });

export const slaQueue =
  connection &&
  new Queue(queueName("sla"), { connection, defaultJobOptions });

export const mediaCleanupQueue =
  connection &&
  new Queue(queueName("media-cleanup"), {
    connection,
    defaultJobOptions,
  });

export const agentSyncQueue =
  connection &&
  new Queue(queueName("agent-sync"), { connection, defaultJobOptions });

global.__mavoQueues = [
  webhookQueue,
  slaQueue,
  mediaCleanupQueue,
  agentSyncQueue,
].filter((queue): queue is Queue => Boolean(queue));

export async function enqueueWebhookEvent(
  name: string,
  data: Record<string, unknown>,
) {
  if (!webhookQueue) return;
  await webhookQueue.add(name, data);
}

export async function enqueueSlaCheck(
  conversationId: string,
  delayMs: number,
) {
  if (!slaQueue) return;
  await slaQueue.add(
    "sla-check",
    { conversationId },
    { delay: delayMs, jobId: `sla-${conversationId}` },
  );
}

export async function closeQueues(): Promise<void> {
  await Promise.all(
    (global.__mavoQueues || []).map((queue) =>
      queue.close().catch(() => undefined),
    ),
  );
  global.__mavoQueues = [];
}
