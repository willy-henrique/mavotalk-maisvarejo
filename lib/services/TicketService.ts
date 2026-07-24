import {
  listConversations,
  getConversation,
  assignConversation,
  closeConversation,
} from "@/lib/repo";

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
    // Encerrar um chamado não apaga seu histórico. Limpeza de mídia deve seguir
    // uma política de retenção explícita, nunca o estado operacional do ticket.
    return closeConversation(organizationId, conversationId, reason);
  },
};
