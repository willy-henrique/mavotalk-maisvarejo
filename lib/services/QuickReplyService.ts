import {
  replaceVariables,
  buildQuickReplyContext,
  extractFirstName,
  getGreeting,
} from "@/lib/quick-reply-service";
import {
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
} from "@/lib/repo";

export const QuickReplyService = {
  replaceVariables,
  buildQuickReplyContext,
  extractFirstName,
  getGreeting,

  async list(organizationId: string) {
    return listQuickReplies(organizationId);
  },

  async create(organizationId: string, payload: { name: string; content: string; category?: string | null }) {
    return createQuickReply(organizationId, payload);
  },

  async update(
    organizationId: string,
    id: string,
    payload: Partial<{ name: string; content: string; category: string | null }>,
  ) {
    return updateQuickReply(organizationId, id, payload);
  },

  async delete(organizationId: string, id: string) {
    return deleteQuickReply(organizationId, id);
  },
};
