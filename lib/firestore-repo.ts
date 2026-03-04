import { FieldValue, Timestamp, type DocumentReference, type QueryDocumentSnapshot, type QuerySnapshot } from "firebase-admin/firestore";
import { db } from "@/lib/firebase-admin";
import { logger } from "@/lib/logger";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/utils";

export type Role = "admin" | "gestor" | "atendente";
export type ConversationStatus = "aguardando" | "em_atendimento" | "pendente_cliente" | "encerrado";
export type FireUser = {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};
export type FireQueue = {
  id: string;
  organizationId: string;
  name: string;
  menuOption: number;
  colorHex: string;
  defaultSlaMins: number;
  isActive: boolean;
};
export type FireConversation = {
  id: string;
  organizationId: string;
  contactId: string;
  contactPhone?: string;
  queueId?: string | null;
  status: ConversationStatus;
  triageCompleted: boolean;
  menuAttempts: number;
};
export type FireBusinessHour = {
  id: string;
  organizationId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  timezone: string;
  isActive: boolean;
};

export type FireQuickReply = {
  id: string;
  organizationId: string;
  name: string;
  content: string;
  category?: string | null;
  createdAt?: string;
};

function fromTimestamp(value: unknown) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date().toISOString();
}

function isFirestoreIndexError(error: unknown) {
  const err = error as { code?: number | string; details?: string };
  return (
    err?.code === 9 ||
    err?.code === "FAILED_PRECONDITION" ||
    (typeof err?.details === "string" && err.details.toLowerCase().includes("requires an index"))
  );
}

function isFirestoreQuotaError(error: unknown): boolean {
  const err = error as { code?: number | string; details?: string; message?: string; cause?: unknown };
  const codeMatch =
    err?.code === 8 ||
    err?.code === "RESOURCE_EXHAUSTED" ||
    (typeof err?.details === "string" && err.details.toLowerCase().includes("quota")) ||
    (typeof err?.message === "string" &&
      (err.message.toLowerCase().includes("resource_exhausted") || err.message.toLowerCase().includes("quota")));
  if (codeMatch) return true;
  if (err?.cause && typeof err.cause === "object") return isFirestoreQuotaError(err.cause);
  return false;
}

export async function getUserById(organizationId: string, id: string): Promise<{ id: string; name: string } | null> {
  const ref = db.collection("users").doc(id);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const data = doc.data() as Record<string, unknown>;
  if (String(data.organizationId || "") !== organizationId) return null;
  return { id: doc.id, name: String(data.name || "") };
}

export async function getUserByEmail(email: string) {
  const snap = await db.collection("users").where("email", "==", email).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data() as Record<string, unknown>;
  return {
    id: doc.id,
    organizationId: String(data.organizationId || ""),
    name: String(data.name || ""),
    email: String(data.email || ""),
    passwordHash: String(data.passwordHash || ""),
    role: (String(data.role || "atendente") as Role),
    isActive: data.isActive !== false,
  } as FireUser;
}

export async function listUsers(organizationId: string): Promise<FireUser[]> {
  try {
    const snap = await db.collection("users").where("organizationId", "==", organizationId).get();
    return snap.docs
    .map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        id: doc.id,
        organizationId: String(data.organizationId || organizationId),
        name: String(data.name || ""),
        email: String(data.email || ""),
        passwordHash: String(data.passwordHash || ""),
        role: String(data.role || "atendente") as Role,
        isActive: data.isActive !== false,
        createdAt: fromTimestamp(data.createdAt),
        updatedAt: fromTimestamp(data.updatedAt),
      } as FireUser;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      logger.warn({ err: error, organizationId }, "Firestore quota exceeded while listing users");
      return [];
    }
    throw error;
  }
}

export async function createUser(
  organizationId: string,
  payload: {
    name: string;
    email: string;
    passwordHash: string;
    role: Role;
    isActive?: boolean;
  },
) {
  const normalizedEmail = payload.email.toLowerCase().trim();
  const existing = await getUserByEmail(normalizedEmail);
  if (existing) {
    return { error: "EMAIL_EXISTS" as const, user: null };
  }

  const ref = db.collection("users").doc();
  await ref.set({
    organizationId,
    name: payload.name.trim(),
    email: normalizedEmail,
    passwordHash: payload.passwordHash,
    role: payload.role,
    isActive: payload.isActive ?? true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const created = await ref.get();
  const data = created.data() as Record<string, unknown>;
  return {
    error: null,
    user: {
      id: ref.id,
      organizationId,
      name: String(data.name || payload.name),
      email: String(data.email || normalizedEmail),
      passwordHash: String(data.passwordHash || payload.passwordHash),
      role: String(data.role || payload.role) as Role,
      isActive: data.isActive !== false,
      createdAt: fromTimestamp(data.createdAt),
      updatedAt: fromTimestamp(data.updatedAt),
    } as FireUser,
  };
}

export async function updateUser(
  organizationId: string,
  id: string,
  payload: Partial<{ name: string; email: string; passwordHash: string; role: Role; isActive: boolean }>,
) {
  const ref = db.collection("users").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { error: "NOT_FOUND" as const, user: null };

  const current = snap.data() as Record<string, unknown>;
  if (String(current.organizationId || "") !== organizationId) {
    return { error: "NOT_FOUND" as const, user: null };
  }

  const updates: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (typeof payload.name === "string") updates.name = payload.name.trim();
  if (typeof payload.role === "string") updates.role = payload.role;
  if (typeof payload.passwordHash === "string") updates.passwordHash = payload.passwordHash;
  if (typeof payload.isActive === "boolean") updates.isActive = payload.isActive;
  if (typeof payload.email === "string") {
    const normalizedEmail = payload.email.toLowerCase().trim();
    const existing = await getUserByEmail(normalizedEmail);
    if (existing && existing.id !== id) {
      return { error: "EMAIL_EXISTS" as const, user: null };
    }
    updates.email = normalizedEmail;
  }

  await ref.update(updates);
  const updated = await ref.get();
  const data = updated.data() as Record<string, unknown>;
  return {
    error: null,
    user: {
      id,
      organizationId,
      name: String(data.name || ""),
      email: String(data.email || ""),
      passwordHash: String(data.passwordHash || ""),
      role: String(data.role || "atendente") as Role,
      isActive: data.isActive !== false,
      createdAt: fromTimestamp(data.createdAt),
      updatedAt: fromTimestamp(data.updatedAt),
    } as FireUser,
  };
}

export async function deactivateUser(organizationId: string, id: string) {
  const result = await updateUser(organizationId, id, { isActive: false });
  return result;
}

export async function listQueues(organizationId: string): Promise<FireQueue[]> {
  try {
    const snap = await db
      .collection("queues")
      .where("organizationId", "==", organizationId)
      .orderBy("menuOption", "asc")
      .get();

    return snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      id: doc.id,
      organizationId: String(data.organizationId || organizationId),
      name: String(data.name || ""),
      menuOption: Number(data.menuOption || 0),
      colorHex: String(data.colorHex || "#64748B"),
      defaultSlaMins: Number(data.defaultSlaMins || 30),
      isActive: data.isActive !== false,
    };
  });
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      logger.warn({ err: error, organizationId }, "Firestore quota exceeded while listing queues");
      return [];
    }
    throw error;
  }
}

export async function createQueue(organizationId: string, payload: Record<string, unknown>): Promise<FireQueue> {
  const ref = db.collection("queues").doc();
  await ref.set({
    organizationId,
    ...payload,
    isActive: payload.isActive ?? true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    id: ref.id,
    organizationId,
    name: String(payload.name || ""),
    menuOption: Number(payload.menuOption || 0),
    colorHex: String(payload.colorHex || "#64748B"),
    defaultSlaMins: Number(payload.defaultSlaMins || 30),
    isActive: payload.isActive !== false,
  };
}

export async function updateQueue(organizationId: string, id: string, payload: Record<string, unknown>): Promise<FireQueue | null> {
  const ref = db.collection("queues").doc(id);
  const existing = await ref.get();
  if (!existing.exists) return null;
  const data = existing.data() as Record<string, unknown>;
  if (data.organizationId !== organizationId) return null;

  await ref.update({
    ...payload,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    id,
    organizationId,
    name: String(payload.name ?? data.name ?? ""),
    menuOption: Number(payload.menuOption ?? data.menuOption ?? 0),
    colorHex: String(payload.colorHex ?? data.colorHex ?? "#64748B"),
    defaultSlaMins: Number(payload.defaultSlaMins ?? data.defaultSlaMins ?? 30),
    isActive: (payload.isActive ?? data.isActive) !== false,
  };
}

export async function createAuditLog(
  organizationId: string,
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  await db.collection("audit_logs").add({
    organizationId,
    userId,
    action,
    entityType,
    entityId,
    metadata,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function listQuickReplies(organizationId: string): Promise<FireQuickReply[]> {
  let snap: QuerySnapshot;
  try {
    snap = await db
      .collection("quick_replies")
      .where("organizationId", "==", organizationId)
      .orderBy("name", "asc")
      .get();
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      logger.warn({ err, organizationId }, "Firestore quota exceeded while listing quick replies");
      return [];
    }
    if (!isFirestoreIndexError(err)) throw err;
    const fallback = await db.collection("quick_replies").where("organizationId", "==", organizationId).get();
    const items = fallback.docs
      .map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        return {
          id: doc.id,
          organizationId: String(data.organizationId || organizationId),
          name: String(data.name || ""),
          content: String(data.content || ""),
          category: data.category != null ? String(data.category) : null,
          createdAt: fromTimestamp(data.createdAt),
        } as FireQuickReply;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return items;
  }
  return snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    return {
      id: doc.id,
      organizationId: String(data.organizationId || organizationId),
      name: String(data.name || ""),
      content: String(data.content || ""),
      category: data.category != null ? String(data.category) : null,
      createdAt: fromTimestamp(data.createdAt),
    } as FireQuickReply;
  });
}

export async function createQuickReply(
  organizationId: string,
  payload: { name: string; content: string; category?: string | null },
): Promise<FireQuickReply> {
  const ref = db.collection("quick_replies").doc();
  await ref.set({
    organizationId,
    name: payload.name.trim(),
    content: payload.content,
    category: payload.category?.trim() || null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return {
    id: ref.id,
    organizationId,
    name: payload.name.trim(),
    content: payload.content,
    category: payload.category?.trim() || null,
    createdAt: fromTimestamp(new Date()),
  };
}

export async function updateQuickReply(
  organizationId: string,
  id: string,
  payload: Partial<{ name: string; content: string; category: string | null }>,
): Promise<FireQuickReply | null> {
  const ref = db.collection("quick_replies").doc(id);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const data = doc.data() as Record<string, unknown>;
  if (String(data.organizationId || "") !== organizationId) return null;

  const updates: Record<string, unknown> = {};
  if (payload.name !== undefined) updates.name = payload.name.trim();
  if (payload.content !== undefined) updates.content = payload.content;
  if (payload.category !== undefined) updates.category = payload.category?.trim() || null;
  if (Object.keys(updates).length === 0) {
    return {
      id,
      organizationId,
      name: String(data.name || ""),
      content: String(data.content || ""),
      category: data.category != null ? String(data.category) : null,
      createdAt: fromTimestamp(data.createdAt),
    } as FireQuickReply;
  }
  await ref.update(updates);
  const updated = (await ref.get()).data() as Record<string, unknown>;
  return {
    id,
    organizationId,
    name: String(updated.name ?? data.name ?? ""),
    content: String(updated.content ?? data.content ?? ""),
    category: updated.category != null ? String(updated.category) : null,
    createdAt: fromTimestamp(updated.createdAt ?? data.createdAt),
  } as FireQuickReply;
}

export async function deleteQuickReply(organizationId: string, id: string): Promise<boolean> {
  const ref = db.collection("quick_replies").doc(id);
  const doc = await ref.get();
  if (!doc.exists) return false;
  const data = doc.data() as Record<string, unknown>;
  if (String(data.organizationId || "") !== organizationId) return false;
  await ref.delete();
  return true;
}

export async function listConversations(organizationId: string, status?: ConversationStatus) {
  let query = db.collection("conversations").where("organizationId", "==", organizationId);
  if (status) query = query.where("status", "==", status);

  const CONVERSATION_LIMIT = 80;
  let conversationDocs: QueryDocumentSnapshot[] = [];
  try {
    const snap = await query.orderBy("updatedAt", "desc").limit(CONVERSATION_LIMIT).get();
    conversationDocs = snap.docs;
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      logger.warn({ err: error, organizationId }, "Firestore quota exceeded while listing conversations");
      return [];
    }
    if (!isFirestoreIndexError(error)) throw error;

    const fallbackSnap = await db
      .collection("conversations")
      .where("organizationId", "==", organizationId)
      .limit(150)
      .get();
    conversationDocs = fallbackSnap.docs
      .filter((doc) => {
        if (!status) return true;
        const data = doc.data() as Record<string, unknown>;
        return String(data.status || "") === status;
      })
      .sort((a, b) => {
        const aTime = (a.data().updatedAt as Timestamp | undefined)?.toDate().getTime() || 0;
        const bTime = (b.data().updatedAt as Timestamp | undefined)?.toDate().getTime() || 0;
        return bTime - aTime;
      })
      .slice(0, CONVERSATION_LIMIT);
  }
  if (conversationDocs.length === 0) return [];

  const conversations: Array<Record<string, unknown> & { id: string }> = conversationDocs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Record<string, unknown>),
  }));

  const MESSAGE_READ_LIMIT = 200;
  let messageDocs: QueryDocumentSnapshot[] = [];
  try {
    const messagesSnap = await db
      .collection("messages")
      .where("organizationId", "==", organizationId)
      .orderBy("createdAt", "desc")
      .limit(MESSAGE_READ_LIMIT)
      .get();
    messageDocs = messagesSnap.docs;
  } catch (messagesError) {
    if (isFirestoreQuotaError(messagesError)) {
      logger.warn({ err: messagesError, organizationId }, "Firestore quota exceeded while loading messages");
      messageDocs = [];
    } else if (!isFirestoreIndexError(messagesError)) {
      throw messagesError;
    } else {
      const messagesSnap = await db
        .collection("messages")
        .where("organizationId", "==", organizationId)
        .limit(MESSAGE_READ_LIMIT)
        .get();
      messageDocs = messagesSnap.docs;
    }
  }

  let contactsSnap: QuerySnapshot | null = null;
  let queuesSnap: QuerySnapshot | null = null;
  let ticketsSnap: QuerySnapshot | null = null;
  let usersSnap: QuerySnapshot | null = null;
  try {
    [contactsSnap, queuesSnap, ticketsSnap, usersSnap] = await Promise.all([
      db.collection("contacts").where("organizationId", "==", organizationId).get(),
      db.collection("queues").where("organizationId", "==", organizationId).get(),
      db.collection("tickets").where("organizationId", "==", organizationId).get(),
      db.collection("users").where("organizationId", "==", organizationId).get(),
    ]);
  } catch (error) {
    if (!isFirestoreQuotaError(error)) throw error;
    logger.warn({ err: error, organizationId }, "Firestore quota exceeded while loading conversation metadata");
  }

  const contacts = new Map((contactsSnap?.docs || []).map((d) => [d.id, { id: d.id, ...(d.data() as Record<string, unknown>) }]));
  const queues = new Map((queuesSnap?.docs || []).map((d) => [d.id, { id: d.id, ...(d.data() as Record<string, unknown>) }]));
  const tickets = new Map(
    (ticketsSnap?.docs || []).map((d) => [
      (d.data() as Record<string, unknown>).conversationId as string,
      { id: d.id, ...(d.data() as Record<string, unknown>) },
    ]),
  );
  const usersByName = new Map(
    (usersSnap?.docs || []).map((d) => {
      const data = d.data() as Record<string, unknown>;
      return [d.id, String(data.name || "")];
    }),
  );

  const messagesByConversation = new Map<string, Array<Record<string, unknown>>>();
  for (const doc of messageDocs) {
    const data = doc.data() as Record<string, unknown>;
    const conversationId = String(data.conversationId);
    const authorId = data.authorId ? String(data.authorId) : undefined;
    const msg: Record<string, unknown> = {
      id: doc.id,
      ...data,
      createdAt: fromTimestamp(data.createdAt),
    };
    if (data.direction === "outbound" && authorId) {
      msg.authorName = usersByName.get(authorId) ?? null;
    }
    if (!messagesByConversation.has(conversationId)) messagesByConversation.set(conversationId, []);
    const current = messagesByConversation.get(conversationId);
    if ((current?.length || 0) >= 50) continue;
    messagesByConversation.get(conversationId)?.push(msg);
  }
  for (const arr of messagesByConversation.values()) {
    arr.sort((a, b) => {
      const ta = (a.createdAt as string | undefined) ?? "";
      const tb = (b.createdAt as string | undefined) ?? "";
      return String(ta).localeCompare(String(tb));
    });
  }

  return conversations.map((item) => {
    const contactId = String(item.contactId);
    const queueId = item.queueId ? String(item.queueId) : null;
    const ticket = (tickets.get(item.id) as (Record<string, unknown> & { id: string }) | undefined) || null;
    const assigneeId = ticket?.assigneeId ? String(ticket.assigneeId) : null;
    const assigneeName = assigneeId ? usersByName.get(assigneeId) ?? null : null;

    const contact = contacts.get(contactId) || {
      id: contactId,
      name: null,
      phoneNumber: item.contactPhone ?? null,
    };

    return {
      id: item.id,
      status: item.status,
      triageCompleted: Boolean(item.triageCompleted),
      createdAt: fromTimestamp(item.createdAt),
      updatedAt: fromTimestamp(item.updatedAt),
      contact,
      queue: queueId ? (queues.get(queueId) ?? null) : null,
      ticket: ticket
        ? {
            ...ticket,
            firstResponseDueAt: ticket.firstResponseDueAt ? fromTimestamp(ticket.firstResponseDueAt) : null,
            assignee: assigneeId && assigneeName ? { id: assigneeId, name: assigneeName } : null,
          }
        : null,
      messages: messagesByConversation.get(item.id) || [],
    };
  });
}

export async function getConversation(organizationId: string, id: string): Promise<FireConversation | null> {
  const ref = db.collection("conversations").doc(id);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const data = doc.data() as Record<string, unknown>;
  if (data.organizationId !== organizationId) return null;
  return {
    id: doc.id,
    organizationId: String(data.organizationId || organizationId),
    contactId: String(data.contactId || ""),
    contactPhone: data.contactPhone ? String(data.contactPhone) : undefined,
    queueId: data.queueId ? String(data.queueId) : null,
    status: (String(data.status || "aguardando") as ConversationStatus),
    triageCompleted: Boolean(data.triageCompleted),
    menuAttempts: Number(data.menuAttempts || 0),
  };
}

export async function assignConversation(organizationId: string, conversationId: string, userId: string) {
  const convRef = db.collection("conversations").doc(conversationId);
  const ticketSnap = await db
    .collection("tickets")
    .where("organizationId", "==", organizationId)
    .where("conversationId", "==", conversationId)
    .limit(1)
    .get();

  await convRef.update({
    status: "em_atendimento",
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (!ticketSnap.empty) {
    await ticketSnap.docs[0].ref.update({
      assigneeId: userId,
      firstResponseAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

export async function addOutboundMessage(
  organizationId: string,
  conversationId: string,
  content: string,
  externalId?: string,
  options?: {
    skipStatusUpdate?: boolean;
    authorId?: string;
    type?: "text" | "image";
    mediaUrl?: string | null;
    cloudinaryPublicId?: string | null;
  },
) {
  if (externalId) {
    const existing = await db
      .collection("messages")
      .where("organizationId", "==", organizationId)
      .where("conversationId", "==", conversationId)
      .where("externalId", "==", externalId)
      .limit(1)
      .get();
    if (!existing.empty) {
      const d = existing.docs[0].data() as Record<string, unknown>;
      return {
        id: existing.docs[0].id,
        organizationId,
        conversationId,
        direction: "outbound",
        type: String(d.type || "text"),
        content: String(d.content || content),
        authorId: d.authorId ? String(d.authorId) : undefined,
      };
    }
  }
  const msgType = options?.type || "text";
  const msgRef = db.collection("messages").doc();
  await msgRef.set({
    organizationId,
    conversationId,
    direction: "outbound",
    type: msgType,
    content,
    externalId: externalId || null,
    authorId: options?.authorId || null,
    mediaUrl: options?.mediaUrl || null,
    cloudinaryPublicId: options?.cloudinaryPublicId || null,
    createdAt: FieldValue.serverTimestamp(),
  });

  if (!options?.skipStatusUpdate) {
    await db.collection("conversations").doc(conversationId).update({
      status: "em_atendimento",
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    await db.collection("conversations").doc(conversationId).update({
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  return {
    id: msgRef.id,
    organizationId,
    conversationId,
    direction: "outbound",
    type: msgType,
    content,
    authorId: options?.authorId,
    mediaUrl: options?.mediaUrl,
    cloudinaryPublicId: options?.cloudinaryPublicId,
  };
}

export async function getCloudinaryPublicIdsForConversation(
  organizationId: string,
  conversationId: string,
): Promise<string[]> {
  const snap = await db
    .collection("messages")
    .where("organizationId", "==", organizationId)
    .where("conversationId", "==", conversationId)
    .get();

  const ids: string[] = [];
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const pid = data.cloudinaryPublicId;
    if (pid && typeof pid === "string") ids.push(pid);
  }
  return ids;
}

export async function closeConversation(organizationId: string, conversationId: string, reason: string) {
  const convRef = db.collection("conversations").doc(conversationId);
  const ticketSnap = await db
    .collection("tickets")
    .where("organizationId", "==", organizationId)
    .where("conversationId", "==", conversationId)
    .limit(1)
    .get();

  await convRef.update({
    status: "encerrado",
    closedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (!ticketSnap.empty) {
    await ticketSnap.docs[0].ref.update({
      closeReason: reason,
      closedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

export async function dashboardMetrics(organizationId: string) {
  const [conversations, tickets, queues] = await Promise.all([
    db.collection("conversations").where("organizationId", "==", organizationId).get(),
    db.collection("tickets").where("organizationId", "==", organizationId).get(),
    db.collection("queues").where("organizationId", "==", organizationId).get(),
  ]);

  let totalAguardando = 0;
  let totalAtendimento = 0;
  let totalEncerrado = 0;

  for (const doc of conversations.docs) {
    const status = (doc.data() as Record<string, unknown>).status;
    if (status === "aguardando") totalAguardando += 1;
    if (status === "em_atendimento") totalAtendimento += 1;
    if (status === "encerrado") totalEncerrado += 1;
  }

  const queueMap = new Map(queues.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));
  const volumeCounter = new Map<string, { queueName: string; colorHex: string; total: number }>();

  let responseSum = 0;
  let responseCount = 0;

  for (const doc of tickets.docs) {
    const data = doc.data() as Record<string, unknown>;
    const queueId = (data.queueId as string | undefined) || "none";

    const queue = queueId === "none" ? null : queueMap.get(queueId);
    const key = queueId;

    if (!volumeCounter.has(key)) {
      volumeCounter.set(key, {
        queueName: queue ? String(queue.name) : "Nao classificado",
        colorHex: queue ? String(queue.colorHex) : "#64748B",
        total: 0,
      });
    }

    volumeCounter.get(key)!.total += 1;

    const createdAt = data.createdAt as Timestamp | undefined;
    const firstResponseAt = data.firstResponseAt as Timestamp | undefined;
    if (createdAt && firstResponseAt) {
      responseSum += (firstResponseAt.toDate().getTime() - createdAt.toDate().getTime()) / 60000;
      responseCount += 1;
    }
  }

  return {
    totalAguardando,
    totalAtendimento,
    totalEncerrado,
    firstResponseAverageMinutes: responseCount > 0 ? Math.round(responseSum / responseCount) : null,
    volumeByDemand: Array.from(volumeCounter.values()).sort((a, b) => b.total - a.total),
  };
}

export async function getContactById(
  organizationId: string,
  contactId: string,
): Promise<{ id: string; name: string; phoneNumber: string } | null> {
  const ref = db.collection("contacts").doc(contactId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const data = doc.data() as Record<string, unknown>;
  if (String(data.organizationId || "") !== organizationId) return null;
  return {
    id: doc.id,
    name: String(data.name || "Cliente"),
    phoneNumber: String(data.phoneNumber || ""),
  };
}

export async function getContactByPhone(organizationId: string, phoneNumber: string) {
  const snap = await db
    .collection("contacts")
    .where("organizationId", "==", organizationId)
    .where("phoneNumber", "==", phoneNumber)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const data = snap.docs[0].data() as Record<string, unknown>;
  return { id: snap.docs[0].id, organizationId, phoneNumber: String(data.phoneNumber || phoneNumber), name: String(data.name || "") };
}

const PLACEHOLDER_NAMES = ["contato", "cliente"];

function isPlaceholderName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return !n || PLACEHOLDER_NAMES.includes(n);
}

export async function getOrCreateContact(organizationId: string, phoneNumber: string, name: string) {
  const snap = await db
    .collection("contacts")
    .where("organizationId", "==", organizationId)
    .where("phoneNumber", "==", phoneNumber)
    .limit(1)
    .get();

  if (!snap.empty) {
    const ref = snap.docs[0].ref;
    const data = snap.docs[0].data() as Record<string, unknown>;
    const currentName = String(data.name ?? "").trim();
    const newName = name.trim();
    // Só atualiza se o novo nome for "de verdade" (não placeholder) e for diferente do atual.
    const shouldUpdateName =
      newName && !isPlaceholderName(newName) && newName !== currentName;
    if (shouldUpdateName) {
      await ref.update({ name: newName, updatedAt: FieldValue.serverTimestamp() });
      return { id: ref.id, organizationId, phoneNumber: String(data.phoneNumber ?? phoneNumber), name: newName };
    }
    return {
      id: ref.id,
      organizationId,
      phoneNumber: String(data.phoneNumber ?? phoneNumber),
      name: currentName || newName || "Contato",
    };
  }

  const ref = db.collection("contacts").doc();
  const finalName = name.trim() || "Contato";
  await ref.set({
    organizationId,
    phoneNumber,
    name: finalName,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { id: ref.id, organizationId, phoneNumber, name: finalName };
}

export async function updateContactAvatar(contactId: string, avatarUrl: string | null) {
  const ref = db.collection("contacts").doc(contactId);
  const doc = await ref.get();
  if (!doc.exists) return;
  await ref.update({
    avatarUrl: avatarUrl || null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export type ListContactItem = {
  id: string;
  name: string;
  phoneNumber: string;
  lastMessage: string | null;
  lastInteraction: string | null;
  status: "ativo" | "encerrado";
  blocked: boolean;
  internalNote: string | null;
  lastConversationId: string | null;
};

export async function listContacts(organizationId: string): Promise<ListContactItem[]> {
  let contactsSnap: QuerySnapshot;
  try {
    contactsSnap = await db.collection("contacts").where("organizationId", "==", organizationId).get();
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      logger.warn({ err: error, organizationId }, "Firestore quota exceeded while listing contacts");
      return [];
    }
    throw error;
  }
  if (contactsSnap.empty) return [];

  const contactIds = contactsSnap.docs.map((d) => d.id);
  const [conversationsSnap, messagesSnap] = await Promise.all([
    db.collection("conversations").where("organizationId", "==", organizationId).get(),
    db.collection("messages").where("organizationId", "==", organizationId).get(),
  ]);

  const conversationsByContact = new Map<string, Array<{ id: string; updatedAt: Date; status: string }>>();
  for (const doc of conversationsSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const contactId = String(data.contactId || "");
    const updatedAt = (data.updatedAt as Timestamp | undefined)?.toDate() || new Date();
    const status = String(data.status || "");
    if (!conversationsByContact.has(contactId)) conversationsByContact.set(contactId, []);
    conversationsByContact.get(contactId)!.push({ id: doc.id, updatedAt, status });
  }

  const messagesByConversation = new Map<string, Array<{ content: string; createdAt: Date }>>();
  for (const doc of messagesSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const conversationId = String(data.conversationId);
    const content = String(data.content || "");
    const createdAt = (data.createdAt as Timestamp | undefined)?.toDate() || new Date();
    if (!messagesByConversation.has(conversationId)) messagesByConversation.set(conversationId, []);
    messagesByConversation.get(conversationId)!.push({ content, createdAt });
  }

  return contactsSnap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const contactId = doc.id;
    const name = String(data.name || "Contato");
    const phoneNumber = String(data.phoneNumber || "");
    const blocked = Boolean(data.blocked);
    const internalNote = data.internalNote != null ? String(data.internalNote) : null;

    const convs = conversationsByContact.get(contactId) || [];
    convs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const lastConv = convs[0];
    let lastMessage: string | null = null;
    let lastInteraction: string | null = null;
    let status: "ativo" | "encerrado" = "encerrado";

    if (lastConv) {
      status = lastConv.status === "encerrado" ? "encerrado" : "ativo";
      lastInteraction = lastConv.updatedAt.toISOString();
      const msgs = messagesByConversation.get(lastConv.id) || [];
      msgs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (msgs[0]) lastMessage = msgs[0].content;
    }

    return {
      id: contactId,
      name,
      phoneNumber,
      lastMessage,
      lastInteraction,
      status,
      blocked,
      internalNote,
      lastConversationId: lastConv?.id ?? null,
    };
  });
}

export async function updateContact(
  organizationId: string,
  contactId: string,
  payload: { name?: string; phoneNumber?: string; blocked?: boolean; internalNote?: string | null },
) {
  const ref = db.collection("contacts").doc(contactId);
  const doc = await ref.get();
  if (!doc.exists) return null;
  const data = doc.data() as Record<string, unknown>;
  if (String(data.organizationId) !== organizationId) return null;

  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (payload.name !== undefined) updates.name = payload.name.trim();
  if (payload.phoneNumber !== undefined) updates.phoneNumber = payload.phoneNumber.trim();
  if (payload.blocked !== undefined) updates.blocked = payload.blocked;
  if (payload.internalNote !== undefined) updates.internalNote = payload.internalNote ?? null;

  if (Object.keys(updates).length <= 1) return { id: contactId, ...data };

  await ref.update(updates);
  return { id: contactId, ...data, ...updates };
}

async function getOpenConversationDocsByContactId(
  organizationId: string,
  contactId: string,
): Promise<QueryDocumentSnapshot[]> {
  try {
    const snap = await db
      .collection("conversations")
      .where("organizationId", "==", organizationId)
      .where("contactId", "==", contactId)
      .where("status", "in", ["aguardando", "em_atendimento", "pendente_cliente"])
      .orderBy("updatedAt", "desc")
      .limit(1)
      .get();
    return snap.docs;
  } catch (error) {
    if (!isFirestoreIndexError(error)) throw error;
    const fallbackSnap = await db
      .collection("conversations")
      .where("organizationId", "==", organizationId)
      .where("contactId", "==", contactId)
      .get();
    return fallbackSnap.docs
      .filter((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const current = String(data.status || "");
        return current === "aguardando" || current === "em_atendimento" || current === "pendente_cliente";
      })
      .sort((a, b) => {
        const aTime = (a.data().updatedAt as Timestamp | undefined)?.toDate().getTime() || 0;
        const bTime = (b.data().updatedAt as Timestamp | undefined)?.toDate().getTime() || 0;
        return bTime - aTime;
      })
      .slice(0, 1);
  }
}

/** Retorna conversa aberta pelo contactId ou null se não existir (não cria). */
export async function getOpenConversationByContactId(
  organizationId: string,
  contactId: string,
): Promise<FireConversation | null> {
  const docs = await getOpenConversationDocsByContactId(organizationId, contactId);
  if (docs.length === 0) return null;
  const data = docs[0].data() as Record<string, unknown>;
  return {
    id: docs[0].id,
    organizationId: String(data.organizationId || organizationId),
    contactId: String(data.contactId || contactId),
    contactPhone: data.contactPhone ? String(data.contactPhone) : undefined,
    queueId: data.queueId ? String(data.queueId) : null,
    status: (String(data.status || "aguardando") as ConversationStatus),
    triageCompleted: Boolean(data.triageCompleted),
    menuAttempts: Number(data.menuAttempts || 0),
  };
}

export async function getOrCreateOpenConversation(
  organizationId: string,
  contactId: string,
  contactPhone: string,
): Promise<(FireConversation & { isNew: boolean })> {
  const docs = await getOpenConversationDocsByContactId(organizationId, contactId);

  if (docs.length > 0) {
    const data = docs[0].data() as Record<string, unknown>;
    if (!data.contactPhone) {
      await docs[0].ref.update({ contactPhone, updatedAt: FieldValue.serverTimestamp() });
    }
    return {
      id: docs[0].id,
      organizationId: String(data.organizationId || organizationId),
      contactId: String(data.contactId || contactId),
      contactPhone: String(data.contactPhone || contactPhone),
      queueId: data.queueId ? String(data.queueId) : null,
      status: (String(data.status || "aguardando") as ConversationStatus),
      triageCompleted: Boolean(data.triageCompleted),
      menuAttempts: Number(data.menuAttempts || 0),
      isNew: false,
    };
  }

  const convRef = db.collection("conversations").doc();
  await convRef.set({
    organizationId,
    contactId,
    contactPhone,
    queueId: null,
    status: "pendente_cliente",
    triageCompleted: false,
    menuAttempts: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const ticketRef = db.collection("tickets").doc();
  await ticketRef.set({
    organizationId,
    conversationId: convRef.id,
    queueId: null,
    assigneeId: null,
    closeReason: null,
    firstResponseAt: null,
    firstResponseDueAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    closedAt: null,
  });

  return {
    id: convRef.id,
    organizationId,
    contactId,
    contactPhone,
    queueId: null,
    status: "aguardando",
    triageCompleted: false,
    menuAttempts: 0,
    isNew: true,
  };
}

export type ContactAndConversation = {
  contact: { id: string; organizationId: string; phoneNumber: string; name: string };
  conversation: FireConversation & { isNew: boolean };
};

/** Atomically get or create contact and open conversation. Prevents race conditions
 * when multiple messages arrive in parallel (avoids duplicate tickets per contact).
 * Firestore requires all reads before any write inside a transaction. */
export async function getOrCreateContactAndOpenConversation(
  organizationId: string,
  contactPhone: string,
  contactName: string,
): Promise<ContactAndConversation> {
  const finalName = contactName.trim() || "Contato";

  return db.runTransaction(async (tx) => {
    // --- 1) ALL READS FIRST (Firestore rule) ---
    const contactQuery = db
      .collection("contacts")
      .where("organizationId", "==", organizationId)
      .where("phoneNumber", "==", contactPhone)
      .limit(1);
    const contactSnap = await tx.get(contactQuery);

    const contactRefForNew = db.collection("contacts").doc();
    let contactId: string;
    let contact: { id: string; organizationId: string; phoneNumber: string; name: string };
    let contactDocRefToUpdate: DocumentReference | null = null;
    let newNameForUpdate: string | null = null;

    if (!contactSnap.empty) {
      const doc = contactSnap.docs[0];
      const data = doc.data() as Record<string, unknown>;
      contactId = doc.id;
      const currentName = String(data.name ?? "").trim();
      const newName = contactName.trim();
      const shouldUpdateName =
        newName && !isPlaceholderName(newName) && newName !== currentName;
      contact = {
        id: doc.id,
        organizationId,
        phoneNumber: contactPhone,
        name: shouldUpdateName ? newName : currentName || newName || "Contato",
      };
      if (shouldUpdateName) {
        contactDocRefToUpdate = doc.ref;
        newNameForUpdate = newName;
      }
    } else {
      contactId = contactRefForNew.id;
      contact = { id: contactId, organizationId, phoneNumber: contactPhone, name: finalName };
    }

    let openConvDocs: QueryDocumentSnapshot[];
    try {
      const convSnap = await tx.get(
        db
          .collection("conversations")
          .where("organizationId", "==", organizationId)
          .where("contactId", "==", contactId)
          .where("status", "in", ["aguardando", "em_atendimento", "pendente_cliente"])
          .orderBy("updatedAt", "desc")
          .limit(1),
      );
      openConvDocs = convSnap.docs;
    } catch (error) {
      if (!isFirestoreIndexError(error)) throw error;
      const fallbackSnap = await tx.get(
        db
          .collection("conversations")
          .where("organizationId", "==", organizationId)
          .where("contactId", "==", contactId),
      );
      openConvDocs = fallbackSnap.docs
        .filter((d) => {
          const s = String((d.data() as Record<string, unknown>).status || "");
          return s === "aguardando" || s === "em_atendimento" || s === "pendente_cliente";
        })
        .sort((a, b) => {
          const at = (a.data().updatedAt as Timestamp | undefined)?.toDate?.()?.getTime() ?? 0;
          const bt = (b.data().updatedAt as Timestamp | undefined)?.toDate?.()?.getTime() ?? 0;
          return bt - at;
        })
        .slice(0, 1);
    }

    // --- 2) ALL WRITES AFTER READS ---
    if (contactDocRefToUpdate && newNameForUpdate) {
      tx.update(contactDocRefToUpdate, { name: newNameForUpdate, updatedAt: FieldValue.serverTimestamp() });
    }
    if (contactSnap.empty) {
      tx.set(contactRefForNew, {
        organizationId,
        phoneNumber: contactPhone,
        name: finalName,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    if (openConvDocs.length > 0) {
      const doc = openConvDocs[0];
      const data = doc.data() as Record<string, unknown>;
      return {
        contact,
        conversation: {
          id: doc.id,
          organizationId: String(data.organizationId || organizationId),
          contactId: String(data.contactId || contactId),
          contactPhone: String(data.contactPhone || contactPhone),
          queueId: data.queueId ? String(data.queueId) : null,
          status: String(data.status || "aguardando") as ConversationStatus,
          triageCompleted: Boolean(data.triageCompleted),
          menuAttempts: Number(data.menuAttempts || 0),
          isNew: false,
        },
      };
    }

    const convRef = db.collection("conversations").doc();
    const ticketRef = db.collection("tickets").doc();
    tx.set(convRef, {
      organizationId,
      contactId,
      contactPhone,
      queueId: null,
      status: "pendente_cliente",
      triageCompleted: false,
      menuAttempts: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(ticketRef, {
      organizationId,
      conversationId: convRef.id,
      queueId: null,
      assigneeId: null,
      closeReason: null,
      firstResponseAt: null,
      firstResponseDueAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      closedAt: null,
    });

    return {
      contact,
      conversation: {
        id: convRef.id,
        organizationId,
        contactId,
        contactPhone,
        queueId: null,
        status: "pendente_cliente",
        triageCompleted: false,
        menuAttempts: 0,
        isNew: true,
      },
    };
  });
}

export async function findMessageByExternalId(
  organizationId: string,
  externalId: string,
): Promise<{ id: string; conversationId: string } | null> {
  if (!externalId) return null;
  try {
    const snap = await db
      .collection("messages")
      .where("organizationId", "==", organizationId)
      .where("externalId", "==", externalId)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const data = snap.docs[0].data() as Record<string, unknown>;
    return {
      id: snap.docs[0].id,
      conversationId: String(data.conversationId || ""),
    };
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      logger.warn({ err: error, organizationId }, "Firestore quota exceeded while deduplicating inbound message");
      return null;
    }
    throw error;
  }
}

export async function addInboundMessage(payload: {
  organizationId: string;
  conversationId: string;
  content: string;
  type: "text" | "image" | "document" | "audio";
  externalId?: string;
  mediaUrl?: string | null;
  mimeType?: string | null;
  cloudinaryPublicId?: string | null;
}) {
  const ref = db.collection("messages").doc();
  await ref.set({
    organizationId: payload.organizationId,
    conversationId: payload.conversationId,
    direction: "inbound",
    type: payload.type,
    content: payload.content,
    externalId: payload.externalId || null,
    mediaUrl: payload.mediaUrl || null,
    mimeType: payload.mimeType || null,
    cloudinaryPublicId: payload.cloudinaryPublicId || null,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { id: ref.id, ...payload };
}

export async function updateConversationById(id: string, payload: Record<string, unknown>) {
  await db.collection("conversations").doc(id).update({
    ...payload,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function updateTicketByConversation(organizationId: string, conversationId: string, payload: Record<string, unknown>) {
  const snap = await db
    .collection("tickets")
    .where("organizationId", "==", organizationId)
    .where("conversationId", "==", conversationId)
    .limit(1)
    .get();

  if (snap.empty) return;
  await snap.docs[0].ref.update({
    ...payload,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function getBusinessHour(organizationId: string, weekday: number): Promise<FireBusinessHour | null> {
  const snap = await db
    .collection("business_hours")
    .where("organizationId", "==", organizationId)
    .where("weekday", "==", weekday)
    .where("isActive", "==", true)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const data = snap.docs[0].data() as Record<string, unknown>;
  return {
    id: snap.docs[0].id,
    organizationId: String(data.organizationId || organizationId),
    weekday: Number(data.weekday || weekday),
    startTime: String(data.startTime || "08:00"),
    endTime: String(data.endTime || "18:00"),
    timezone: String(data.timezone || "America/Sao_Paulo"),
    isActive: data.isActive !== false,
  };
}

export async function resolveOrganizationByChannel(to: string | null) {
  if (!to) return DEFAULT_ORGANIZATION_ID;
  const snap = await db
    .collection("channels")
    .where("twilioPhoneNumber", "==", to)
    .where("isActive", "==", true)
    .limit(1)
    .get();

  if (snap.empty) return DEFAULT_ORGANIZATION_ID;
  return String((snap.docs[0].data() as Record<string, unknown>).organizationId || DEFAULT_ORGANIZATION_ID);
}

// Compat: ambiente Firestore não grava nota, apenas ignora.
export async function recordSatisfactionRatingByPhone(
  _organizationId: string,
  _phoneNumber: string,
  _rawBody: string,
): Promise<boolean> {
  return false;
}
