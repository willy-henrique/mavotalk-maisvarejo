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
} from "@/lib/firestore-repo";
import * as firestoreRepo from "@/lib/firestore-repo";
import * as supabaseRepo from "@/lib/supabase-repo";

const provider = (process.env.DB_PROVIDER || "firestore").toLowerCase();
const useSupabase = provider === "supabase";

export type { Role, ConversationStatus, FireUser, FireQueue, FireConversation, FireQuickReply, FireBusinessHour, ListContactItem, ContactAndConversation };

function pick<K extends keyof typeof firestoreRepo>(
  key: K,
): (typeof firestoreRepo)[K] {
  if (useSupabase && key in supabaseRepo) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (supabaseRepo as any)[key] as (typeof firestoreRepo)[K];
  }
  return firestoreRepo[key];
}

// Users
export const getUserById = pick("getUserById");
export const getUserByEmail = pick("getUserByEmail");
export const listUsers = pick("listUsers");
export const createUser = pick("createUser");
export const updateUser = pick("updateUser");
export const deactivateUser = pick("deactivateUser");

// Queues
export const listQueues = pick("listQueues");
export const createQueue = pick("createQueue");
export const updateQueue = pick("updateQueue");

// Audit
export const createAuditLog = pick("createAuditLog");

// Quick Replies
export const listQuickReplies = pick("listQuickReplies");
export const createQuickReply = pick("createQuickReply");
export const updateQuickReply = pick("updateQuickReply");
export const deleteQuickReply = pick("deleteQuickReply");

// Conversations
export const listConversations = pick("listConversations");
export const getConversation = pick("getConversation");
export const assignConversation = pick("assignConversation");
export const closeConversation = pick("closeConversation");
export const updateConversationById = pick("updateConversationById");

// Messages
export const addOutboundMessage = pick("addOutboundMessage");
export const addInboundMessage = pick("addInboundMessage");
export const findMessageByExternalId = pick("findMessageByExternalId");
export const getCloudinaryPublicIdsForConversation = pick("getCloudinaryPublicIdsForConversation");

// Contacts
export const getContactById = pick("getContactById");
export const getContactByPhone = pick("getContactByPhone");
export const getOrCreateContact = pick("getOrCreateContact");
export const updateContact = pick("updateContact");
export const updateContactAvatar = pick("updateContactAvatar");
export const listContacts = pick("listContacts");
export const getOrCreateOpenConversation = pick("getOrCreateOpenConversation");
export const getOrCreateContactAndOpenConversation = pick("getOrCreateContactAndOpenConversation");
export const getOpenConversationByContactId = pick("getOpenConversationByContactId");

// Tickets
export const updateTicketByConversation = pick("updateTicketByConversation");

// Dashboard / Metrics
export const dashboardMetrics = pick("dashboardMetrics");

// Business Hours
export const getBusinessHour = pick("getBusinessHour");

// Channel resolver
export const resolveOrganizationByChannel = pick("resolveOrganizationByChannel");

// Satisfaction rating
export const recordSatisfactionRatingByPhone = pick("recordSatisfactionRatingByPhone");
