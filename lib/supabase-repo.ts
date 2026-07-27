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
import { getSupabaseClient } from "@/lib/supabase-admin";
import type { Row, SupabaseLikeClient } from "@/lib/postgres-supabase-shim";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { SUPERMARKET_QUEUE_PRESET } from "@/lib/supermarket-config";
import { randomUUID } from "node:crypto";

// Both providers expose the fluent subset implemented by the local shim.
// The repository normalizes every returned row before exposing it to callers.
function supa(): SupabaseLikeClient {
  return getSupabaseClient() as SupabaseLikeClient;
}

function requireOrganizationId(organizationId: string): string {
  const value = String(organizationId || "").trim();
  if (!value) throw new Error("Contexto de organização ausente");
  return value;
}

function iso(d: string | null | undefined): string {
  if (!d) return new Date().toISOString();
  return new Date(d).toISOString();
}

const PLACEHOLDER_NAMES = ["contato", "cliente"];
function isPlaceholderName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return !n || PLACEHOLDER_NAMES.includes(n);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function getUserById(
  organizationId: string,
  id: string,
): Promise<
  Pick<
    FireUser,
    "id" | "organizationId" | "name" | "email" | "role" | "isActive"
  > | null
> {
  const { data, error } = await supa()
    .from("users")
    .select("id, organization_id, name, email, role, is_active")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) { logger.error({ err: error }, "supa getUserById"); throw error; }
  if (!data) return null;
  return {
    id: String(data.id),
    organizationId: String(data.organization_id),
    name: String(data.name ?? ""),
    email: String(data.email ?? ""),
    role: String(data.role ?? "atendente") as Role,
    isActive: data.is_active !== false,
  };
}

export async function getUserByEmail(email: string): Promise<FireUser | null> {
  const { data, error } = await supa()
    .from("users")
    .select("*")
    .ilike("email", email.trim().toLowerCase())
    .maybeSingle();
  if (error) { logger.error({ err: error }, "supa getUserByEmail"); throw error; }
  if (!data) return null;
  return {
    id: String(data.id),
    organizationId: String(data.organization_id),
    name: String(data.name ?? ""),
    email: String(data.email ?? ""),
    passwordHash: String(data.password_hash ?? ""),
    role: String(data.role ?? "atendente") as Role,
    isActive: data.is_active !== false,
    createdAt: (data.created_at as string | null) ?? undefined,
    updatedAt: (data.updated_at as string | null) ?? undefined,
  };
}

export async function listUsers(organizationId: string): Promise<FireUser[]> {
  const orgId = requireOrganizationId(organizationId);
  const { data, error } = await supa()
    .from("users")
    .select("*")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });
  if (error) { logger.error({ err: error, organizationId: orgId }, "supa listUsers"); throw error; }
  return (data ?? []).map((row): FireUser => ({
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name ?? ""),
    email: String(row.email ?? ""),
    passwordHash: String(row.password_hash ?? ""),
    role: String(row.role ?? "atendente") as Role,
    isActive: row.is_active !== false,
    createdAt: (row.created_at as string | null) ?? undefined,
    updatedAt: (row.updated_at as string | null) ?? undefined,
  }));
}

export async function createUser(
  organizationId: string,
  payload: { name: string; email: string; passwordHash: string; role: Role; isActive?: boolean },
): Promise<{ error: "EMAIL_EXISTS" | null; user: FireUser | null }> {
  const orgId = requireOrganizationId(organizationId);
  const normalizedEmail = payload.email.toLowerCase().trim();
  const { data: existing } = await supa()
    .from("users")
    .select("id")
    .ilike("email", normalizedEmail)
    .maybeSingle();
  if (existing) return { error: "EMAIL_EXISTS", user: null };

  const id = randomUUID();
  const { data, error } = await supa()
    .from("users")
    .insert({
      id,
      organization_id: orgId,
      name: payload.name.trim(),
      email: normalizedEmail,
      password_hash: payload.passwordHash,
      role: payload.role,
      is_active: payload.isActive ?? true,
    })
    .select("*")
    .maybeSingle();
  if (error) { logger.error({ err: error, organizationId: orgId }, "supa createUser"); throw error; }
  if (!data) return { error: null, user: null };
  return {
    error: null,
    user: {
      id: String(data.id),
      organizationId: String(data.organization_id),
      name: String(data.name ?? ""),
      email: String(data.email ?? ""),
      passwordHash: String(data.password_hash ?? ""),
      role: String(data.role ?? "atendente") as Role,
      isActive: data.is_active !== false,
      createdAt: (data.created_at as string | null) ?? undefined,
      updatedAt: (data.updated_at as string | null) ?? undefined,
    },
  };
}

export async function updateUser(
  organizationId: string,
  id: string,
  payload: Partial<{ name: string; email: string; passwordHash: string; role: Role; isActive: boolean }>,
): Promise<{ error: "NOT_FOUND" | "EMAIL_EXISTS" | null; user: FireUser | null }> {
  const orgId = requireOrganizationId(organizationId);
  const { data: current } = await supa()
    .from("users")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!current) return { error: "NOT_FOUND", user: null };

  const updates: Record<string, unknown> = {};
  if (typeof payload.name === "string") updates.name = payload.name.trim();
  if (typeof payload.role === "string") updates.role = payload.role;
  if (typeof payload.passwordHash === "string") updates.password_hash = payload.passwordHash;
  if (typeof payload.isActive === "boolean") updates.is_active = payload.isActive;
  if (typeof payload.email === "string") {
    const norm = payload.email.toLowerCase().trim();
    const { data: dup } = await supa()
      .from("users")
      .select("id")
      .ilike("email", norm)
      .neq("id", id)
      .maybeSingle();
    if (dup) return { error: "EMAIL_EXISTS", user: null };
    updates.email = norm;
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supa()
    .from("users")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("*")
    .maybeSingle();
  if (error) { logger.error({ err: error, organizationId: orgId }, "supa updateUser"); throw error; }
  if (!data) return { error: "NOT_FOUND", user: null };
  return {
    error: null,
    user: {
      id: String(data.id),
      organizationId: String(data.organization_id),
      name: String(data.name ?? ""),
      email: String(data.email ?? ""),
      passwordHash: String(data.password_hash ?? ""),
      role: String(data.role ?? "atendente") as Role,
      isActive: data.is_active !== false,
      createdAt: (data.created_at as string | null) ?? undefined,
      updatedAt: (data.updated_at as string | null) ?? undefined,
    },
  };
}

export async function deactivateUser(
  organizationId: string,
  id: string,
) {
  return updateUser(organizationId, id, { isActive: false });
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

export async function listQueues(organizationId: string): Promise<FireQueue[]> {
  const orgId = requireOrganizationId(organizationId);

  // 1) Tenta carregar filas já existentes
  let data: Row[] | null;
  {
    const { data: rows, error } = await supa()
      .from("queues")
      .select("*")
      .eq("organization_id", orgId)
      .order("menu_option", { ascending: true });
    if (error) {
      logger.error({ err: error, organizationId: orgId }, "supa listQueues");
      throw error;
    }
    data = rows;
  }

  // 2) Se não houver nenhuma fila cadastrada, cria o menu padrão do supermercado.
  if (!data || data.length === 0) {
    const defaults = SUPERMARKET_QUEUE_PRESET.map((queue) => ({
      id: randomUUID(),
      organization_id: orgId,
      name: queue.name,
      menu_option: queue.menuOption,
      color_hex: queue.colorHex,
      default_sla_mins: queue.defaultSlaMins,
      is_active: true,
    }));

    const { data: inserted, error: insertError } = await supa()
      .from("queues")
      .insert(defaults)
      .select("*")
      .order("menu_option", { ascending: true });

    if (insertError) {
      // Não quebrar fluxo inbound por divergência de schema em queues.
      // Nesse caso, o caller trata como sem filas (fallback de aguardando).
      logger.error({ err: insertError, organizationId: orgId }, "supa listQueues seed defaults failed");
      data = [];
    } else {
      data = inserted ?? defaults;
    }
  }

  // 3) Normaliza retorno para o formato FireQueue
  return (data ?? []).map((row): FireQueue => ({
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name ?? ""),
    menuOption: Number(row.menu_option ?? 0),
    colorHex: String(row.color_hex ?? "#64748B"),
    defaultSlaMins: Number(row.default_sla_mins ?? 30),
    isActive: row.is_active !== false,
  }));
}

export async function createQueue(organizationId: string, payload: Record<string, unknown>): Promise<FireQueue> {
  const orgId = requireOrganizationId(organizationId);
  const id = randomUUID();
  const { data, error } = await supa()
    .from("queues")
    .insert({
      id,
      organization_id: orgId,
      name: String(payload.name ?? ""),
      menu_option: Number(payload.menuOption ?? 0),
      color_hex: String(payload.colorHex ?? "#64748B"),
      default_sla_mins: Number(payload.defaultSlaMins ?? 30),
      is_active: (payload.isActive as boolean | undefined) ?? true,
    })
    .select("*")
    .maybeSingle();
  if (error) { logger.error({ err: error, organizationId: orgId }, "supa createQueue"); throw error; }
  return {
    id,
    organizationId: orgId,
    name: String(data?.name ?? payload.name ?? ""),
    menuOption: Number(data?.menu_option ?? payload.menuOption ?? 0),
    colorHex: String(data?.color_hex ?? payload.colorHex ?? "#64748B"),
    defaultSlaMins: Number(data?.default_sla_mins ?? payload.defaultSlaMins ?? 30),
    isActive: (data?.is_active ?? payload.isActive) !== false,
  };
}

export async function updateQueue(
  organizationId: string,
  id: string,
  payload: Record<string, unknown>,
): Promise<FireQueue | null> {
  const orgId = requireOrganizationId(organizationId);
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("name" in payload) updates.name = String(payload.name ?? "");
  if ("menuOption" in payload) updates.menu_option = Number(payload.menuOption ?? 0);
  if ("colorHex" in payload) updates.color_hex = String(payload.colorHex ?? "#64748B");
  if ("defaultSlaMins" in payload) updates.default_sla_mins = Number(payload.defaultSlaMins ?? 30);
  if ("isActive" in payload) updates.is_active = (payload.isActive as boolean | undefined) ?? true;

  const { data, error } = await supa()
    .from("queues")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("*")
    .maybeSingle();
  if (error) { logger.error({ err: error, organizationId: orgId }, "supa updateQueue"); throw error; }
  if (!data) return null;
  return {
    id,
    organizationId: orgId,
    name: String(data.name ?? ""),
    menuOption: Number(data.menu_option ?? 0),
    colorHex: String(data.color_hex ?? "#64748B"),
    defaultSlaMins: Number(data.default_sla_mins ?? 30),
    isActive: data.is_active !== false,
  };
}

// ---------------------------------------------------------------------------
// Audit Logs
// ---------------------------------------------------------------------------

export async function createAuditLog(
  organizationId: string,
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await supa().from("audit_logs").insert({
    id: randomUUID(),
    organization_id: organizationId,
    user_id: userId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
  });
  if (error) logger.error({ err: error }, "supa createAuditLog");
}

// ---------------------------------------------------------------------------
// Quick Replies
// ---------------------------------------------------------------------------

export async function listQuickReplies(organizationId: string): Promise<FireQuickReply[]> {
  const { data, error } = await supa()
    .from("quick_replies")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true });
  if (error) { logger.error({ err: error }, "supa listQuickReplies"); throw error; }
  return (data ?? []).map((r): FireQuickReply => ({
    id: String(r.id),
    organizationId: String(r.organization_id),
    name: String(r.name ?? ""),
    content: String(r.content ?? ""),
    category: r.category != null ? String(r.category) : null,
    createdAt: iso(r.created_at),
  }));
}

export async function createQuickReply(
  organizationId: string,
  payload: { name: string; content: string; category?: string | null },
): Promise<FireQuickReply> {
  const id = randomUUID();
  const { data, error } = await supa()
    .from("quick_replies")
    .insert({
      id,
      organization_id: organizationId,
      name: payload.name.trim(),
      content: payload.content,
      category: payload.category?.trim() || null,
    })
    .select("*")
    .maybeSingle();
  if (error) { logger.error({ err: error }, "supa createQuickReply"); throw error; }
  return {
    id,
    organizationId,
    name: String(data?.name ?? payload.name.trim()),
    content: String(data?.content ?? payload.content),
    category: data?.category != null ? String(data.category) : (payload.category?.trim() || null),
    createdAt: iso(data?.created_at),
  };
}

export async function updateQuickReply(
  organizationId: string,
  id: string,
  payload: Partial<{ name: string; content: string; category: string | null }>,
): Promise<FireQuickReply | null> {
  const { data: existing } = await supa()
    .from("quick_replies")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!existing) return null;

  const updates: Record<string, unknown> = {};
  if (payload.name !== undefined) updates.name = payload.name.trim();
  if (payload.content !== undefined) updates.content = payload.content;
  if (payload.category !== undefined) updates.category = payload.category?.trim() || null;
  if (Object.keys(updates).length === 0) {
    return {
      id,
      organizationId,
      name: String(existing.name ?? ""),
      content: String(existing.content ?? ""),
      category: existing.category != null ? String(existing.category) : null,
      createdAt: iso(existing.created_at),
    };
  }
  const { data, error } = await supa()
    .from("quick_replies")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select("*")
    .maybeSingle();
  if (error) { logger.error({ err: error }, "supa updateQuickReply"); throw error; }
  if (!data) return null;
  return {
    id,
    organizationId,
    name: String(data.name ?? ""),
    content: String(data.content ?? ""),
    category: data.category != null ? String(data.category) : null,
    createdAt: iso(data.created_at),
  };
}

export async function deleteQuickReply(organizationId: string, id: string): Promise<boolean> {
  const { data } = await supa()
    .from("quick_replies")
    .delete()
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select("id")
    .maybeSingle();
  return !!data;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function listConversations(organizationId: string, status?: ConversationStatus) {
  let query = supa()
    .from("conversations")
    .select("*")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(80);
  if (status) query = query.eq("status", status);

  const { data: convRows, error: convErr } = await query;
  if (convErr) { logger.error({ err: convErr }, "supa listConversations"); throw convErr; }
  if (!convRows || convRows.length === 0) return [];

  const [
    { data: msgRows },
    { data: contactRows },
    { data: queueRows },
    { data: ticketRows },
    { data: userRows },
  ] = await Promise.all([
    supa()
      .from("messages")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(200),
    supa().from("contacts").select("*").eq("organization_id", organizationId),
    supa().from("queues").select("*").eq("organization_id", organizationId),
    supa().from("tickets").select("*").eq("organization_id", organizationId),
    supa().from("users").select("id, name").eq("organization_id", organizationId),
  ]);

  const contacts = new Map((contactRows ?? []).map((r) => [r.id, r]));
  const queues = new Map((queueRows ?? []).map((r) => [r.id, r]));
  const ticketsByConv = new Map((ticketRows ?? []).map((r) => [r.conversation_id, r]));
  const userNames = new Map((userRows ?? []).map((r) => [r.id, String(r.name ?? "")]));

  const msgByConv = new Map<string, Array<Record<string, unknown>>>();
  for (const m of msgRows ?? []) {
    const cid = String(m.conversation_id);
    if (!msgByConv.has(cid)) msgByConv.set(cid, []);
    const arr = msgByConv.get(cid)!;
    if (arr.length >= 50) continue;
    const msg: Record<string, unknown> = {
      id: m.id,
      organizationId: m.organization_id,
      conversationId: m.conversation_id,
      direction: m.direction,
      type: m.type,
      content: m.content,
      externalId: m.external_id,
      authorId: m.author_id,
      mediaUrl: m.media_url,
      mimeType: m.mime_type,
      cloudinaryPublicId: m.cloudinary_public_id,
      createdAt: iso(m.created_at),
    };
    if (m.direction === "outbound" && m.author_id) {
      msg.authorName = userNames.get(m.author_id) ?? null;
    }
    arr.push(msg);
  }
  for (const arr of msgByConv.values()) {
    arr.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
  }

  return convRows.map((item) => {
    const contactId = String(item.contact_id);
    const queueId = item.queue_id ? String(item.queue_id) : null;
    const ticket = ticketsByConv.get(item.id) ?? null;
    const assigneeId = ticket?.assignee_id ? String(ticket.assignee_id) : null;
    const assigneeName = assigneeId ? userNames.get(assigneeId) ?? null : null;

    const raw = contacts.get(contactId);
    const contact = raw
      ? {
          id: raw.id,
          organizationId: raw.organization_id,
          phoneNumber: raw.phone_number,
          name: raw.name,
          avatarUrl: raw.avatar_url ?? null,
        }
      : { id: contactId, name: null, phoneNumber: item.contact_phone ?? null, avatarUrl: null };

    const rawQ = queueId ? queues.get(queueId) : null;
    const queue = rawQ
      ? {
          id: rawQ.id,
          organizationId: rawQ.organization_id,
          name: rawQ.name,
          menuOption: rawQ.menu_option,
          colorHex: rawQ.color_hex,
          defaultSlaMins: rawQ.default_sla_mins,
          isActive: rawQ.is_active,
        }
      : null;

    return {
      id: item.id,
      status: item.status,
      triageCompleted: Boolean(item.triage_completed),
      createdAt: iso(item.created_at),
      updatedAt: iso(item.updated_at),
      contact,
      queue,
      ticket: ticket
        ? {
            id: ticket.id,
            organizationId: ticket.organization_id,
            conversationId: ticket.conversation_id,
            queueId: ticket.queue_id,
            assigneeId: ticket.assignee_id,
            closeReason: ticket.close_reason,
            firstResponseAt: ticket.first_response_at ? iso(ticket.first_response_at) : null,
            firstResponseDueAt: ticket.first_response_due_at ? iso(ticket.first_response_due_at) : null,
            createdAt: iso(ticket.created_at),
            updatedAt: iso(ticket.updated_at),
            closedAt: ticket.closed_at ? iso(ticket.closed_at) : null,
            assignee: assigneeId && assigneeName ? { id: assigneeId, name: assigneeName } : null,
          }
        : null,
      messages: msgByConv.get(item.id) || [],
    };
  });
}

export async function getConversation(organizationId: string, id: string): Promise<FireConversation | null> {
  const { data, error } = await supa()
    .from("conversations")
    .select("*")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) { logger.error({ err: error }, "supa getConversation"); throw error; }
  if (!data) return null;
  return {
    id: data.id,
    organizationId: String(data.organization_id),
    contactId: String(data.contact_id),
    contactPhone: data.contact_phone ?? undefined,
    queueId: data.queue_id ?? null,
    status: String(data.status ?? "aguardando") as ConversationStatus,
    triageCompleted: Boolean(data.triage_completed),
    menuAttempts: Number(data.menu_attempts ?? 0),
  };
}

export async function assignConversation(organizationId: string, conversationId: string, userId: string) {
  const now = new Date().toISOString();
  await supa()
    .from("conversations")
    .update({ status: "em_atendimento", updated_at: now })
    .eq("id", conversationId)
    .eq("organization_id", organizationId);

  await supa()
    .from("tickets")
    .update({ assignee_id: userId, first_response_at: now, updated_at: now })
    .eq("conversation_id", conversationId)
    .eq("organization_id", organizationId);
}

export async function closeConversation(organizationId: string, conversationId: string, reason: string) {
  const now = new Date().toISOString();
  await supa()
    .from("conversations")
    .update({ status: "encerrado", closed_at: now, updated_at: now })
    .eq("id", conversationId)
    .eq("organization_id", organizationId);

  await supa()
    .from("tickets")
    .update({ close_reason: reason, closed_at: now, updated_at: now })
    .eq("conversation_id", conversationId)
    .eq("organization_id", organizationId);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

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
    const { data: dup } = await supa()
      .from("messages")
      .select("id, content, type, author_id")
      .eq("organization_id", organizationId)
      .eq("conversation_id", conversationId)
      .eq("external_id", externalId)
      .maybeSingle();
    if (dup) {
      return {
        id: dup.id,
        organizationId,
        conversationId,
        direction: "outbound",
        type: String(dup.type || "text"),
        content: String(dup.content || content),
        authorId: dup.author_id ?? undefined,
      };
    }
  }

  const msgType = options?.type || "text";
  const id = randomUUID();
  const { error: insertError } = await supa().from("messages").insert({
    id,
    organization_id: organizationId,
    conversation_id: conversationId,
    direction: "outbound",
    type: msgType,
    content,
    external_id: externalId || null,
    author_id: options?.authorId || null,
    media_url: options?.mediaUrl || null,
    cloudinary_public_id: options?.cloudinaryPublicId || null,
  });
  if (insertError) {
    logger.error(
      { err: insertError, organizationId, conversationId },
      "supa addOutboundMessage: failed to persist message",
    );
    throw insertError;
  }

  const now = new Date().toISOString();
  if (!options?.skipStatusUpdate) {
    await supa()
      .from("conversations")
      .update({ status: "em_atendimento", updated_at: now })
      .eq("id", conversationId)
      .eq("organization_id", organizationId);
  } else {
    await supa()
      .from("conversations")
      .update({ updated_at: now })
      .eq("id", conversationId)
      .eq("organization_id", organizationId);
  }

  return {
    id,
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
  const id = randomUUID();
  const { error: insertError } = await supa().from("messages").insert({
    id,
    organization_id: payload.organizationId,
    conversation_id: payload.conversationId,
    direction: "inbound",
    type: payload.type,
    content: payload.content,
    external_id: payload.externalId || null,
    media_url: payload.mediaUrl || null,
    mime_type: payload.mimeType || null,
    cloudinary_public_id: payload.cloudinaryPublicId || null,
  });
  if (insertError) {
    logger.error(
      {
        err: insertError,
        organizationId: payload.organizationId,
        conversationId: payload.conversationId,
      },
      "supa addInboundMessage: failed to persist message",
    );
    throw insertError;
  }
  const now = new Date().toISOString();
  const { error: bumpErr } = await supa()
    .from("conversations")
    .update({ updated_at: now })
    .eq("id", payload.conversationId)
    .eq("organization_id", payload.organizationId);
  if (bumpErr) {
    logger.warn(
      { err: bumpErr, conversationId: payload.conversationId },
      "supa addInboundMessage: failed to bump conversation updated_at",
    );
  }
  return { id, ...payload };
}

export async function findMessageByExternalId(
  organizationId: string,
  externalId: string,
): Promise<{ id: string; conversationId: string } | null> {
  if (!externalId) return null;
  const { data, error } = await supa()
    .from("messages")
    .select("id, conversation_id")
    .eq("organization_id", organizationId)
    .eq("external_id", externalId)
    .maybeSingle();
  if (error) { logger.error({ err: error }, "supa findMessageByExternalId"); return null; }
  if (!data) return null;
  return { id: String(data.id), conversationId: String(data.conversation_id) };
}

export async function getCloudinaryPublicIdsForConversation(
  organizationId: string,
  conversationId: string,
): Promise<string[]> {
  const { data } = await supa()
    .from("messages")
    .select("cloudinary_public_id")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .not("cloudinary_public_id", "is", null);
  return (data ?? []).map((r) => String(r.cloudinary_public_id)).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function getContactById(
  organizationId: string,
  contactId: string,
): Promise<{ id: string; name: string; phoneNumber: string; blocked: boolean } | null> {
  const { data } = await supa()
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: String(data.id),
    name: String(data.name ?? "Cliente"),
    phoneNumber: String(data.phone_number ?? ""),
    blocked: Boolean(data.blocked),
  };
}

export async function getContactByPhone(organizationId: string, phoneNumber: string) {
  const { data } = await supa()
    .from("contacts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("phone_number", phoneNumber)
    .maybeSingle();
  if (!data) return null;
  return {
    id: String(data.id),
    organizationId,
    phoneNumber: String(data.phone_number ?? phoneNumber),
    name: String(data.name ?? ""),
    blocked: Boolean(data.blocked),
  };
}

export async function isContactBlocked(organizationId: string, phoneNumber: string): Promise<boolean> {
  const contact = await getContactByPhone(organizationId, phoneNumber);
  return contact?.blocked === true;
}

export async function getOrCreateContact(organizationId: string, phoneNumber: string, name: string) {
  const { data: existing } = await supa()
    .from("contacts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("phone_number", phoneNumber)
    .maybeSingle();

  if (existing) {
    const currentName = String(existing.name ?? "").trim();
    const newName = name.trim();
    const shouldUpdate = newName && !isPlaceholderName(newName) && newName !== currentName;
    if (shouldUpdate) {
      await supa()
        .from("contacts")
        .update({ name: newName, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .eq("organization_id", organizationId);
      return { id: String(existing.id), organizationId, phoneNumber: String(existing.phone_number), name: newName };
    }
    return {
      id: String(existing.id),
      organizationId,
      phoneNumber: String(existing.phone_number ?? phoneNumber),
      name: currentName || newName || "Contato",
    };
  }

  const id = randomUUID();
  const finalName = name.trim() || "Contato";
  await supa().from("contacts").insert({
    id,
    organization_id: organizationId,
    phone_number: phoneNumber,
    name: finalName,
  });
  return { id, organizationId, phoneNumber, name: finalName };
}

export async function updateContactAvatar(
  organizationId: string,
  contactId: string,
  avatarUrl: string | null,
) {
  await supa()
    .from("contacts")
    .update({ avatar_url: avatarUrl || null, updated_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("organization_id", organizationId);
}

export async function listContacts(organizationId: string): Promise<ListContactItem[]> {
  const { data: contactRows, error } = await supa()
    .from("contacts")
    .select("*")
    .eq("organization_id", organizationId);
  if (error) { logger.error({ err: error }, "supa listContacts"); throw error; }
  if (!contactRows || contactRows.length === 0) return [];

  const [{ data: convRows }, { data: msgRows }] = await Promise.all([
    supa().from("conversations").select("id, contact_id, status, updated_at").eq("organization_id", organizationId),
    supa().from("messages").select("conversation_id, content, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }),
  ]);

  const convsByContact = new Map<string, Array<{ id: string; updatedAt: Date; status: string }>>();
  for (const c of convRows ?? []) {
    const cid = String(c.contact_id);
    if (!convsByContact.has(cid)) convsByContact.set(cid, []);
    convsByContact.get(cid)!.push({
      id: c.id,
      updatedAt: new Date(c.updated_at),
      status: String(c.status ?? ""),
    });
  }

  const msgsByConv = new Map<string, Array<{ content: string; createdAt: Date }>>();
  for (const m of msgRows ?? []) {
    const cid = String(m.conversation_id);
    if (!msgsByConv.has(cid)) msgsByConv.set(cid, []);
    msgsByConv.get(cid)!.push({ content: String(m.content ?? ""), createdAt: new Date(m.created_at) });
  }

  return contactRows.map((row): ListContactItem => {
    const contactId = String(row.id);
    const convs = convsByContact.get(contactId) ?? [];
    convs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const lastConv = convs[0];

    let lastMessage: string | null = null;
    let lastInteraction: string | null = null;
    let status: "ativo" | "encerrado" = "encerrado";

    if (lastConv) {
      status = lastConv.status === "encerrado" ? "encerrado" : "ativo";
      lastInteraction = lastConv.updatedAt.toISOString();
      const msgs = msgsByConv.get(lastConv.id) ?? [];
      msgs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (msgs[0]) lastMessage = msgs[0].content;
    }

    return {
      id: contactId,
      name: String(row.name ?? "Contato"),
      phoneNumber: String(row.phone_number ?? ""),
      lastMessage,
      lastInteraction,
      status,
      blocked: Boolean(row.blocked),
      internalNote: row.internal_note != null ? String(row.internal_note) : null,
      lastConversationId: lastConv?.id ?? null,
    };
  });
}

export async function updateContact(
  organizationId: string,
  contactId: string,
  payload: { name?: string; phoneNumber?: string; blocked?: boolean; internalNote?: string | null },
) {
  const { data: existing } = await supa()
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!existing) return null;

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (payload.name !== undefined) updates.name = payload.name.trim();
  if (payload.phoneNumber !== undefined) updates.phone_number = payload.phoneNumber.trim();
  if (payload.blocked !== undefined) updates.blocked = payload.blocked;
  if (payload.internalNote !== undefined) updates.internal_note = payload.internalNote ?? null;
  if (Object.keys(updates).length <= 1) {
    return {
      id: contactId,
      organizationId: existing.organization_id,
      phoneNumber: existing.phone_number,
      name: existing.name,
      blocked: existing.blocked,
      internalNote: existing.internal_note,
    };
  }

  const { data } = await supa()
    .from("contacts")
    .update(updates)
    .eq("id", contactId)
    .eq("organization_id", organizationId)
    .select("*")
    .maybeSingle();
  return data ? { id: contactId, ...data } : null;
}

// ---------------------------------------------------------------------------
// Open Conversation helpers
// ---------------------------------------------------------------------------

async function getOpenConversation(
  organizationId: string,
  contactId: string,
): Promise<FireConversation | null> {
  // 1) Tenta encontrar uma conversa realmente aberta (aguardando / em atendimento / pendente_cliente)
  const { data: openConv } = await supa()
    .from("conversations")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("contact_id", contactId)
    .in("status", ["aguardando", "em_atendimento", "pendente_cliente"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const data = openConv;
  if (!data) return null;
  return {
    id: data.id,
    organizationId: String(data.organization_id),
    contactId: String(data.contact_id),
    contactPhone: data.contact_phone ?? undefined,
    queueId: data.queue_id ?? null,
    status: String(data.status ?? "aguardando") as ConversationStatus,
    triageCompleted: Boolean(data.triage_completed),
    menuAttempts: Number(data.menu_attempts ?? 0),
  };
}

export async function getOpenConversationByContactId(
  organizationId: string,
  contactId: string,
): Promise<FireConversation | null> {
  return getOpenConversation(organizationId, contactId);
}

export async function getOrCreateOpenConversation(
  organizationId: string,
  contactId: string,
  contactPhone: string,
): Promise<FireConversation & { isNew: boolean }> {
  const existing = await getOpenConversation(organizationId, contactId);
  if (existing) {
    if (!existing.contactPhone) {
      await supa()
        .from("conversations")
        .update({ contact_phone: contactPhone, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .eq("organization_id", organizationId);
    }
    return { ...existing, contactPhone: existing.contactPhone || contactPhone, isNew: false };
  }

  const convId = randomUUID();
  const ticketId = randomUUID();
  const now = new Date().toISOString();

  await supa().from("conversations").insert({
    id: convId,
    organization_id: organizationId,
    contact_id: contactId,
    contact_phone: contactPhone,
    queue_id: null,
    // Nova conversa entra diretamente como "aguardando" para já aparecer na fila,
    // mesmo enquanto o cliente está escolhendo a opção do menu.
    status: "aguardando",
    triage_completed: false,
    menu_attempts: 0,
    created_at: now,
    updated_at: now,
  });

  await supa().from("tickets").insert({
    id: ticketId,
    organization_id: organizationId,
    conversation_id: convId,
    queue_id: null,
    assignee_id: null,
    close_reason: null,
    first_response_at: null,
    first_response_due_at: null,
    created_at: now,
    updated_at: now,
    closed_at: null,
  });

  return {
    id: convId,
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

export async function getOrCreateContactAndOpenConversation(
  organizationId: string,
  contactPhone: string,
  contactName: string,
): Promise<ContactAndConversation> {
  const finalName = contactName.trim() || "Contato";

  // Upsert contact
  const { data: existingContact } = await supa()
    .from("contacts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("phone_number", contactPhone)
    .maybeSingle();

  let contact: { id: string; organizationId: string; phoneNumber: string; name: string };

  if (existingContact) {
    const currentName = String(existingContact.name ?? "").trim();
    const newName = contactName.trim();
    const shouldUpdate = newName && !isPlaceholderName(newName) && newName !== currentName;
    if (shouldUpdate) {
      await supa()
        .from("contacts")
        .update({ name: newName, updated_at: new Date().toISOString() })
        .eq("id", existingContact.id)
        .eq("organization_id", organizationId);
    }
    contact = {
      id: String(existingContact.id),
      organizationId,
      phoneNumber: contactPhone,
      name: shouldUpdate ? newName : currentName || newName || "Contato",
    };
  } else {
    const id = randomUUID();
    await supa().from("contacts").insert({
      id,
      organization_id: organizationId,
      phone_number: contactPhone,
      name: finalName,
    });
    contact = { id, organizationId, phoneNumber: contactPhone, name: finalName };
  }

  // Find or create open conversation
  const conversation = await getOrCreateOpenConversation(organizationId, contact.id, contactPhone);
  return { contact, conversation };
}

// ---------------------------------------------------------------------------
// Conversation / Ticket Updates
// ---------------------------------------------------------------------------

export async function updateConversationById(
  organizationId: string,
  id: string,
  payload: Record<string, unknown>,
) {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("status" in payload) updates.status = payload.status;
  if ("queueId" in payload) updates.queue_id = payload.queueId;
  if ("triageCompleted" in payload) updates.triage_completed = payload.triageCompleted;
  if ("menuAttempts" in payload) updates.menu_attempts = payload.menuAttempts;
  if ("contactPhone" in payload) updates.contact_phone = payload.contactPhone;
  await supa()
    .from("conversations")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", organizationId);
}

export async function updateTicketByConversation(
  organizationId: string,
  conversationId: string,
  payload: Record<string, unknown>,
) {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("queueId" in payload) updates.queue_id = payload.queueId;
  if ("assigneeId" in payload) updates.assignee_id = payload.assigneeId;
  if ("firstResponseDueAt" in payload) updates.first_response_due_at = payload.firstResponseDueAt instanceof Date
    ? payload.firstResponseDueAt.toISOString()
    : payload.firstResponseDueAt;
  if ("firstResponseAt" in payload) updates.first_response_at = payload.firstResponseAt;
  if ("closeReason" in payload) updates.close_reason = payload.closeReason;
  if ("closedAt" in payload) updates.closed_at = payload.closedAt;

  await supa()
    .from("tickets")
    .update(updates)
    .eq("conversation_id", conversationId)
    .eq("organization_id", organizationId);
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function dashboardMetrics(organizationId: string) {
  const [{ data: convRows }, { data: ticketRows }, { data: queueRows }] = await Promise.all([
    supa().from("conversations").select("status").eq("organization_id", organizationId),
    supa().from("tickets").select("queue_id, created_at, first_response_at, satisfaction_score").eq("organization_id", organizationId),
    supa().from("queues").select("id, name, color_hex").eq("organization_id", organizationId),
  ]);

  let totalAguardando = 0;
  let totalAtendimento = 0;
  let totalEncerrado = 0;
  for (const c of convRows ?? []) {
    if (c.status === "aguardando") totalAguardando++;
    else if (c.status === "em_atendimento") totalAtendimento++;
    else if (c.status === "encerrado") totalEncerrado++;
  }

  const queueMap = new Map((queueRows ?? []).map((q) => [q.id, q]));
  const volumeCounter = new Map<string, { queueName: string; colorHex: string; total: number }>();
  let responseSum = 0;
  let responseCount = 0;
  let ratingSum = 0;
  let ratingCount = 0;

  for (const t of ticketRows ?? []) {
    const queueId = t.queue_id || "none";
    const queue = queueId === "none" ? null : queueMap.get(queueId);
    if (!volumeCounter.has(queueId)) {
      volumeCounter.set(queueId, {
        queueName: queue ? String(queue.name) : "Nao classificado",
        colorHex: queue ? String(queue.color_hex) : "#64748B",
        total: 0,
      });
    }
    volumeCounter.get(queueId)!.total++;

    if (t.created_at && t.first_response_at) {
      const diff = (new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime()) / 60000;
      responseSum += diff;
      responseCount++;
    }

    if (typeof t.satisfaction_score === "number" && t.satisfaction_score >= 1 && t.satisfaction_score <= 5) {
      ratingSum += t.satisfaction_score;
      ratingCount++;
    }
  }

  return {
    totalAguardando,
    totalAtendimento,
    totalEncerrado,
    firstResponseAverageMinutes: responseCount > 0 ? Math.round(responseSum / responseCount) : null,
    volumeByDemand: Array.from(volumeCounter.values()).sort((a, b) => b.total - a.total),
    satisfactionAverage: ratingCount > 0 ? Number((ratingSum / ratingCount).toFixed(2)) : null,
  };
}

// ---------------------------------------------------------------------------
// Business Hours
// ---------------------------------------------------------------------------

export async function getBusinessHour(
  organizationId: string,
  weekday: number,
): Promise<FireBusinessHour | null> {
  const { data } = await supa()
    .from("business_hours")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("weekday", weekday)
    .maybeSingle();
  if (!data) return null;
  return {
    id: String(data.id),
    organizationId: String(data.organization_id),
    weekday: Number(data.weekday),
    startTime: String(data.start_time ?? "08:00"),
    endTime: String(data.end_time ?? "18:00"),
    timezone: String(data.timezone ?? "America/Sao_Paulo"),
    isActive: data.is_active !== false,
  };
}

// ---------------------------------------------------------------------------
// Channel / Organization Resolver
// ---------------------------------------------------------------------------

export async function resolveOrganizationByChannel(to: string | null) {
  if (!to) return DEFAULT_ORGANIZATION_ID;
  const { data } = await supa()
    .from("channels")
    .select("organization_id")
    .eq("twilio_phone_number", to)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return DEFAULT_ORGANIZATION_ID;
  return String(data.organization_id || DEFAULT_ORGANIZATION_ID);
}

let resolvedOrgIdCache: { value: string; expiresAt: number } | null = null;
const RESOLVE_ORG_ID_CACHE_MS = 60_000;

/**
 * `DEFAULT_ORG_ID` é lido de forma independente pelo bootstrap de deploy (roda a
 * cada build) e por scripts de seed rodados manualmente (ex.: seed-supabase.mjs).
 * Se esses dois pontos divergirem, mensagens do WhatsApp são gravadas sob uma
 * organização diferente da que o usuário logado enxerga — o ticket nunca aparece
 * no inbox, mesmo com o WhatsApp conectado. Quando isso acontece e só existe UMA
 * organização real no banco, autocorrigimos para ela e avisamos alto no log.
 */
export async function resolveDefaultOrganizationId(candidateOrgId: string): Promise<string> {
  const now = Date.now();
  if (resolvedOrgIdCache && resolvedOrgIdCache.expiresAt > now) {
    return resolvedOrgIdCache.value;
  }

  const { data, error } = await supa().from("organizations").select("id");
  if (error || !data) {
    logger.error(
      { err: error, candidateOrgId },
      "resolveDefaultOrganizationId: falha ao listar organizations; mantendo valor configurado",
    );
    return candidateOrgId;
  }

  const knownOrgIds = data.map((row) => String(row.id));
  let resolved = candidateOrgId;
  if (!knownOrgIds.includes(candidateOrgId)) {
    if (knownOrgIds.length === 1) {
      resolved = knownOrgIds[0];
      logger.error(
        { configuredOrgId: candidateOrgId, actualOrgId: resolved },
        "DEFAULT_ORG_ID não corresponde a nenhuma organizacao existente no banco; usando a unica organizacao encontrada. Corrija a variavel de ambiente DEFAULT_ORG_ID para eliminar este aviso.",
      );
    } else {
      logger.error(
        { configuredOrgId: candidateOrgId, knownOrgIds },
        "DEFAULT_ORG_ID nao corresponde a nenhuma organizacao existente e ha multiplas organizacoes no banco; nao foi possivel autocorrigir. Mensagens do WhatsApp podem ficar invisiveis no painel ate a variavel ser corrigida manualmente.",
      );
    }
  }

  resolvedOrgIdCache = { value: resolved, expiresAt: now + RESOLVE_ORG_ID_CACHE_MS };
  return resolved;
}

// ---------------------------------------------------------------------------
// Satisfaction rating (1–5) by reply on WhatsApp
// ---------------------------------------------------------------------------

export async function recordSatisfactionRatingByPhone(
  organizationId: string,
  phoneNumber: string,
  rawBody: string,
): Promise<boolean> {
  const body = (rawBody || "").trim();
  if (!/^[1-5]$/.test(body)) return false;
  const score = Number(body);

  // 1) Localiza contato pelo telefone
  const { data: contact } = await supa()
    .from("contacts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("phone_number", phoneNumber)
    .maybeSingle();
  if (!contact) return false;

  // 2) Pega a última conversa encerrada desse contato
  const { data: conv } = await supa()
    .from("conversations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("contact_id", contact.id)
    .eq("status", "encerrado")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conv) return false;

  // 3) Atualiza o ticket vinculado com a nota (sem sobrescrever se já existir)
  const { data: ticket } = await supa()
    .from("tickets")
    .select("id, satisfaction_score")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conv.id)
    .limit(1)
    .maybeSingle();
  if (!ticket) return false;
  if (typeof ticket.satisfaction_score === "number") {
    // Já tinha nota, não sobrescreve
    return false;
  }

  const { error } = await supa()
    .from("tickets")
    .update({ satisfaction_score: score, satisfaction_rated_at: new Date().toISOString() })
    .eq("id", ticket.id)
    .eq("organization_id", organizationId);

  if (error) {
    logger.error({ err: error, organizationId, phoneNumber }, "Failed to record satisfaction rating");
    return false;
  }

  return true;
}
