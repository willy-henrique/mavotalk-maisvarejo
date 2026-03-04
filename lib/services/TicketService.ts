import {
  listConversations,
  getConversation,
  assignConversation,
  closeConversation,
  getCloudinaryPublicIdsForConversation,
} from "@/lib/repo";
import { addCloudinaryCleanupJob } from "@/lib/cloudinary-queue";
import { logger } from "@/lib/logger";

export const TicketService = {
  async list(organizationId: string, status?: string) {
    return listConversations(organizationId, status as "aguardando" | "em_atendimento" | "pendente_cliente" | "encerrado");
  },

  async get(organizationId: string, id: string) {
    return getConversation(organizationId, id);
  },

  async assign(organizationId: string, conversationId: string, userId: string) {
    return assignConversation(organizationId, conversationId, userId);
  },

  async close(organizationId: string, conversationId: string, reason: string) {
    try {
      const publicIds = await getCloudinaryPublicIdsForConversation(organizationId, conversationId);
      if (publicIds.length > 0) {
        // Dispara limpeza de mídia em background, sem bloquear fechamento do chamado.
        void addCloudinaryCleanupJob(publicIds).catch((err) => {
          logger.warn({ err, organizationId, conversationId }, "Failed to enqueue Cloudinary cleanup job (async)");
        });
      }
    } catch (err) {
      // Se Redis/Cloudinary falhar ao obter IDs, não vamos bloquear o fechamento do chamado.
      logger.warn({ err, organizationId, conversationId }, "Failed to enqueue Cloudinary cleanup job");
    }
    return closeConversation(organizationId, conversationId, reason);
  },
};
