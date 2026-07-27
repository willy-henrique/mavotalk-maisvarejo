import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("worker mantém somente filas com processamento e produtor reais", async () => {
  const [queues, worker, mediaQueue] = await Promise.all([
    readFile("lib/queues.ts", "utf8"),
    readFile("worker.mjs", "utf8"),
    readFile("lib/cloudinary-queue.ts", "utf8"),
  ]);

  assert.match(queues, /export const slaQueue/);
  assert.match(queues, /export const mediaCleanupQueue/);
  assert.doesNotMatch(queues, /webhookQueue|agentSyncQueue|enqueueWebhookEvent/);
  assert.match(worker, /worker\("sla"/);
  assert.match(worker, /worker\("media-cleanup"/);
  assert.doesNotMatch(worker, /worker\("webhooks"|worker\("agent-sync"/);
  assert.match(mediaQueue, /mediaCleanupQueue\.add\("delete-resources"/);
});
