import { Queue } from "bullmq";

const redisUrl = process.env.REDIS_URL;
let queue: Queue | null = null;

function getQueue(): Queue | null {
  if (!redisUrl) return null;
  if (!queue) {
    queue = new Queue("cloudinary-cleanup", {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
    });
  }
  return queue;
}

export async function addCloudinaryCleanupJob(publicIds: string[]): Promise<void> {
  const q = getQueue();
  if (!q || publicIds.length === 0) return;
  await q.add("delete-resources", { publicIds });
}
