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
  recordUserLogin,
  listUsers,
  listUsersPage,
  listTeamForPresence,
  createUser,
  updateUser,
  deactivateUser,
  listQueues,
  createQueue,
  updateQueue,
  deleteQueue,
  createAuditLog,
  listQuickReplies,
  listQuickRepliesPage,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  listConversations,
  getConversation,
  assignConversation,
  transferConversation,
  closeConversation,
  updateConversationById,
  addOutboundMessage,
  addInboundMessage,
  findMessageByExternalId,
  getCloudinaryAssetsForConversation,
  getMessageMediaForConversation,
  getContactById,
  getContactByPhone,
  getContactInboundPolicy,
  isContactBlocked,
  getOrCreateContact,
  updateContact,
  updateContactAvatar,
  updateWhatsappContactAvatarsByPhone,
  listContactPhoneNumbersForAvatarSync,
  listContacts,
  listContactsPage,
  getOrCreateOpenConversation,
  getOrCreateContactAndOpenConversation,
  getOpenConversationByContactId,
  getLatestConversationByPhone,
  updateTicketByConversation,
  dashboardMetrics,
  getBusinessHour,
  resolveOrganizationByChannel,
  resolveDefaultOrganizationId,
  recordSatisfactionRatingByPhone,
  upsertWhatsappDirectoryEntries,
  findWhatsappDirectoryName,
  importWhatsappContacts,
  deleteImportedWhatsappContacts,
  clearWhatsappDirectory,
  countWhatsappDirectory,
} from "@/lib/supabase-repo";

export type { TeamMemberForPresence, ConversationMediaAsset } from "@/lib/supabase-repo";

export { getOrganizationDefaultQueueId } from "@/lib/supabase-repo";
