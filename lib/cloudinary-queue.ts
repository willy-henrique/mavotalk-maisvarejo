import { deleteCloudinaryResources } from "@/lib/cloudinary";
import { logger } from "@/lib/logger";
import { mediaCleanupQueue } from "@/lib/queues";

/**
 * Remove imagens do Cloudinary. Com Redis disponível o trabalho vai para a fila;
 * sem ele — o caso do plano gratuito — a exclusão acontece na hora, para que a
 * imagem não fique órfã depois que o registro já saiu do banco.
 */
export async function addCloudinaryCleanupJob(
  publicIds: string[],
): Promise<void> {
  if (publicIds.length === 0) return;
  if (!mediaCleanupQueue) {
    logger.info({ count: publicIds.length }, "cloudinary_cleanup_inline");
    await deleteCloudinaryResources(publicIds);
    return;
  }
  await mediaCleanupQueue.add("delete-resources", { publicIds });
}
