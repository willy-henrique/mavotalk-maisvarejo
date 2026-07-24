import { mediaCleanupQueue } from "@/lib/queues";

export async function addCloudinaryCleanupJob(
  publicIds: string[],
): Promise<void> {
  if (!mediaCleanupQueue || publicIds.length === 0) return;
  await mediaCleanupQueue.add("delete-resources", { publicIds });
}
