import type {
  Role,
  ConversationStatus,
  FireUser,
  FireQueue,
  FireConversation,
  FireQuickReply,
  FireBusinessHour,
  ListContactItem,
  ContactAndConversation,
} from "@/lib/repo-types";

const provider = (process.env.DB_PROVIDER || "supabase").toLowerCase();
const legacyPostgresAliases = new Set(["postgres", "postgresql"]);

if (process.env.NODE_ENV === "production" && provider !== "supabase") {
  throw new Error("DB_PROVIDER deve ser 'supabase' em produção");
}

if (provider !== "supabase" && !legacyPostgresAliases.has(provider)) {
  throw new Error(
    `DB_PROVIDER '${provider}' não é suportado. Use 'supabase'.`,
  );
}

export type {
  Role,
  ConversationStatus,
  FireUser,
  FireQueue,
  FireConversation,
  FireQuickReply,
  FireBusinessHour,
  ListContactItem,
  ContactAndConversation,
};

export {
  getUserById,
  getUserByEmail,
  listUsers,
  createUser,
  updateUser,
  deactivateUser,
  listQueues,
  createQueue,
  updateQueue,
  createAuditLog,
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  listConversations,
  getConversation,
  assignConversation,
  closeConversation,
  updateConversationById,
  addOutboundMessage,
  addInboundMessage,
  findMessageByExternalId,
  getCloudinaryPublicIdsForConversation,
  getContactById,
  getContactByPhone,
  getOrCreateContact,
  updateContact,
  updateContactAvatar,
  listContacts,
  getOrCreateOpenConversation,
  getOrCreateContactAndOpenConversation,
  getOpenConversationByContactId,
  updateTicketByConversation,
  dashboardMetrics,
  getBusinessHour,
  resolveOrganizationByChannel,
  recordSatisfactionRatingByPhone,
} from "@/lib/supabase-repo";
