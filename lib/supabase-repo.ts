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
import { createTenantPostgresSupabaseShim, type Row, type SupabaseLikeClient } from "@/lib/postgres-supabase-shim";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { enqueueSlaCheck } from "@/lib/queues";
import { SUPERMARKET_QUEUE_PRESET } from "@/lib/supermarket-config";
import { randomUUID } from "node:crypto";
import { queryTenantDatabase, withTenantTransaction } from "@/lib/db";

// Login e resolução inicial de canal ainda precisam de uma leitura de
// plataforma para descobrir a organização. Todo fluxo que já recebeu um
// organizationId usa `supa(organizationId)` para executar sob RLS.
function platformSupa(): SupabaseLikeClient {
  return getSupabaseClient() as SupabaseLikeClient;
}

function requireOrganizationId(organizationId: string): string {
  const value = String(organizationId || "").trim();
  if (!value) throw new Error("Contexto de organização ausente");
  return value;
}

function supa(organizationId?: string): SupabaseLikeClient {
  return organizationId
    ? createTenantPostgresSupabaseShim(requireOrganizationId(organizationId))
    : platformSupa();
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
  const { data, error } = await supa(organizationId)
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
  const { data, error } = await platformSupa()
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
    lastLoginAt: (data.last_login_at as string | null) ?? undefined,
  };
}

export async function listUsers(organizationId: string): Promise<FireUser[]> {
  const orgId = requireOrganizationId(organizationId);
  const { data, error } = await supa(orgId)
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
    lastLoginAt: (row.last_login_at as string | null) ?? undefined,
  }));
}

/**
 * Lista paginada usada pelo painel operacional. Mantém o contexto RLS estrito
 * do tenant e evita enviar toda a equipe para o navegador.
 */
export async function listUsersPage(
  organizationId: string,
  options: {
    page: number;
    pageSize: number;
    query?: string;
    role?: Role;
    status?: "active" | "inactive";
  },
): Promise<{ items: FireUser[]; total: number }> {
  const orgId = requireOrganizationId(organizationId);
  const page = Math.max(1, options.page);
  const pageSize = Math.min(100, Math.max(1, options.pageSize));
  const offset = (page - 1) * pageSize;
  const clauses = ["organization_id = $1"];
  const values: unknown[] = [orgId];
  const add = (clause: string, value: unknown) => {
    values.push(value);
    clauses.push(clause.replace("?", `$${values.length}`));
  };
  const query = options.query?.trim();
  if (query) {
    values.push(`%${query}%`);
    const parameter = `$${values.length}`;
    clauses.push(`(name ILIKE ${parameter} OR email ILIKE ${parameter})`);
  }
  if (options.role) add("role = ?", options.role);
  if (options.status === "active") clauses.push("is_active = true");
  if (options.status === "inactive") clauses.push("is_active = false");
  const where = clauses.join(" AND ");
  type UserPageRow = {
    id: string;
    organization_id: string;
    name: string | null;
    email: string | null;
    password_hash: string | null;
    role: Role | null;
    is_active: boolean | null;
    created_at: string | null;
    updated_at: string | null;
    last_login_at: string | null;
  };
  const [items, count] = await Promise.all([
    queryTenantDatabase<UserPageRow>(
      orgId,
      `SELECT id, organization_id, name, email, password_hash, role, is_active,
              created_at, updated_at, last_login_at
         FROM users
        WHERE ${where}
        ORDER BY name, id
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, offset],
    ),
    queryTenantDatabase<{ count: string }>(
      orgId,
      `SELECT COUNT(*)::text AS count FROM users WHERE ${where}`,
      values,
    ),
  ]);
  return {
    items: items.rows.map((row) => ({
      id: String(row.id),
      organizationId: String(row.organization_id),
      name: String(row.name ?? ""),
      email: String(row.email ?? ""),
      passwordHash: String(row.password_hash ?? ""),
      role: (row.role ?? "atendente") as Role,
      isActive: row.is_active !== false,
      createdAt: row.created_at ?? undefined,
      updatedAt: row.updated_at ?? undefined,
      lastLoginAt: row.last_login_at ?? undefined,
    })),
    total: Number(count.rows[0]?.count || 0),
  };
}

export async function createUser(
  organizationId: string,
  payload: { name: string; email: string; passwordHash: string; role: Role; isActive?: boolean },
): Promise<{ error: "EMAIL_EXISTS" | null; user: FireUser | null }> {
  const orgId = requireOrganizationId(organizationId);
  const normalizedEmail = payload.email.toLowerCase().trim();
  // O schema atual impõe e-mail único globalmente; esta leitura de identidade
  // evita devolver uma falha genérica de índice ao administrador. Nenhum dado
  // da conta encontrada é exposto; a inserção permanece no contexto RLS.
  const { data: existing } = await platformSupa()
    .from("users")
    .select("id")
    .ilike("email", normalizedEmail)
    .maybeSingle();
  if (existing) return { error: "EMAIL_EXISTS", user: null };

  const id = randomUUID();
  const { data, error } = await supa(orgId)
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
      lastLoginAt: (data.last_login_at as string | null) ?? undefined,
    },
  };
}

export async function updateUser(
  organizationId: string,
  id: string,
  payload: Partial<{ name: string; email: string; passwordHash: string; role: Role; isActive: boolean }>,
): Promise<{ error: "NOT_FOUND" | "EMAIL_EXISTS" | null; user: FireUser | null }> {
  const orgId = requireOrganizationId(organizationId);
  const { data: current } = await supa(orgId)
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
    // Ver comentário em createUser: a identidade de login é global neste
    // schema, enquanto a atualização em si permanece tenant-aware.
    const { data: dup } = await platformSupa()
      .from("users")
      .select("id")
      .ilike("email", norm)
      .neq("id", id)
      .maybeSingle();
    if (dup) return { error: "EMAIL_EXISTS", user: null };
    updates.email = norm;
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supa(orgId)
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
      lastLoginAt: (data.last_login_at as string | null) ?? undefined,
    },
  };
}

export async function deactivateUser(
  organizationId: string,
  id: string,
) {
  return updateUser(organizationId, id, { isActive: false });
}

export async function recordUserLogin(organizationId: string, id: string): Promise<void> {
  const orgId = requireOrganizationId(organizationId);
  try {
    const { error } = await supa(orgId)
      .from("users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", orgId);
    if (error) {
      logger.warn({ err: error, organizationId: orgId, userId: id }, "supa recordUserLogin");
    }
  } catch (error) {
    logger.warn({ err: error, organizationId: orgId, userId: id }, "Unable to record user login");
  }
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

export async function listQueues(organizationId: string): Promise<FireQueue[]> {
  const orgId = requireOrganizationId(organizationId);

  // 1) Tenta carregar filas já existentes
  let data: Row[] | null;
  {
    const { data: rows, error } = await supa(orgId)
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

    const { data: inserted, error: insertError } = await supa(orgId)
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
  const { data, error } = await supa(orgId)
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

  const { data, error } = await supa(orgId)
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

export type DeleteQueueResult = "deleted" | "in_use" | "not_found";

/** Exclui somente fila sem conversas/tickets para preservar o histórico operacional. */
export async function deleteQueue(organizationId: string, id: string): Promise<DeleteQueueResult> {
  const orgId = requireOrganizationId(organizationId);
  const [conversationCheck, ticketCheck] = await Promise.all([
    supa(orgId).from("conversations").select("id").eq("organization_id", orgId).eq("queue_id", id),
    supa(orgId).from("tickets").select("id").eq("organization_id", orgId).eq("queue_id", id),
  ]);
  if (conversationCheck.error) throw conversationCheck.error;
  if (ticketCheck.error) throw ticketCheck.error;
  if ((conversationCheck.data?.length ?? 0) > 0 || (ticketCheck.data?.length ?? 0) > 0) return "in_use";

  const { data, error } = await supa(orgId)
    .from("queues")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id")
    .maybeSingle();
  if (error) {
    // Uma atribuição concorrente entre a checagem e a exclusão é barrada pela FK.
    if ((error as { code?: string }).code === "23503") return "in_use";
    logger.error({ err: error, organizationId: orgId, queueId: id }, "supa deleteQueue");
    throw error;
  }
  return data ? "deleted" : "not_found";
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
  const orgId = requireOrganizationId(organizationId);
  const { error } = await supa(orgId).from("audit_logs").insert({
    id: randomUUID(),
    organization_id: orgId,
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
  const orgId = requireOrganizationId(organizationId);
  const { data, error } = await supa(orgId)
    .from("quick_replies")
    .select("*")
    .eq("organization_id", orgId)
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

export async function listQuickRepliesPage(
  organizationId: string,
  options: { page: number; pageSize: number; query?: string },
): Promise<{ items: FireQuickReply[]; total: number }> {
  const orgId = requireOrganizationId(organizationId);
  const page = Math.max(1, options.page);
  const pageSize = Math.min(100, Math.max(1, options.pageSize));
  const offset = (page - 1) * pageSize;
  const clauses = ["organization_id = $1"];
  const values: unknown[] = [orgId];
  const query = options.query?.trim();
  if (query) {
    values.push(`%${query}%`);
    const parameter = `$${values.length}`;
    clauses.push(`(name ILIKE ${parameter} OR content ILIKE ${parameter} OR category ILIKE ${parameter})`);
  }
  const where = clauses.join(" AND ");
  type QuickReplyPageRow = {
    id: string;
    organization_id: string;
    name: string | null;
    content: string | null;
    category: string | null;
    created_at: string | null;
  };
  const [items, count] = await Promise.all([
    queryTenantDatabase<QuickReplyPageRow>(
      orgId,
      `SELECT id, organization_id, name, content, category, created_at
         FROM quick_replies
        WHERE ${where}
        ORDER BY name, id
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, offset],
    ),
    queryTenantDatabase<{ count: string }>(
      orgId,
      `SELECT COUNT(*)::text AS count FROM quick_replies WHERE ${where}`,
      values,
    ),
  ]);
  return {
    items: items.rows.map((row) => ({
      id: String(row.id),
      organizationId: String(row.organization_id),
      name: String(row.name ?? ""),
      content: String(row.content ?? ""),
      category: row.category != null ? String(row.category) : null,
      createdAt: iso(row.created_at),
    })),
    total: Number(count.rows[0]?.count || 0),
  };
}

export async function createQuickReply(
  organizationId: string,
  payload: { name: string; content: string; category?: string | null },
): Promise<FireQuickReply> {
  const orgId = requireOrganizationId(organizationId);
  const id = randomUUID();
  const { data, error } = await supa(orgId)
    .from("quick_replies")
    .insert({
      id,
      organization_id: orgId,
      name: payload.name.trim(),
      content: payload.content,
      category: payload.category?.trim() || null,
    })
    .select("*")
    .maybeSingle();
  if (error) { logger.error({ err: error }, "supa createQuickReply"); throw error; }
  return {
    id,
    organizationId: orgId,
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
  const orgId = requireOrganizationId(organizationId);
  const { data: existing } = await supa(orgId)
    .from("quick_replies")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!existing) return null;

  const updates: Record<string, unknown> = {};
  if (payload.name !== undefined) updates.name = payload.name.trim();
  if (payload.content !== undefined) updates.content = payload.content;
  if (payload.category !== undefined) updates.category = payload.category?.trim() || null;
  if (Object.keys(updates).length === 0) {
    return {
      id,
      organizationId: orgId,
      name: String(existing.name ?? ""),
      content: String(existing.content ?? ""),
      category: existing.category != null ? String(existing.category) : null,
      createdAt: iso(existing.created_at),
    };
  }
  const { data, error } = await supa(orgId)
    .from("quick_replies")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("*")
    .maybeSingle();
  if (error) { logger.error({ err: error }, "supa updateQuickReply"); throw error; }
  if (!data) return null;
  return {
    id,
    organizationId: orgId,
    name: String(data.name ?? ""),
    content: String(data.content ?? ""),
    category: data.category != null ? String(data.category) : null,
    createdAt: iso(data.created_at),
  };
}

export async function deleteQuickReply(organizationId: string, id: string): Promise<boolean> {
  const orgId = requireOrganizationId(organizationId);
  const { data } = await supa(orgId)
    .from("quick_replies")
    .delete()
    .eq("id", id)
    .eq("organization_id", orgId)
    .select("id")
    .maybeSingle();
  return !!data;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function listConversations(organizationId: string, status?: ConversationStatus) {
  const orgId = requireOrganizationId(organizationId);
  let query = supa(orgId)
    .from("conversations")
    .select("*")
    .eq("organization_id", orgId)
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
    supa(orgId)
      .from("messages")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200),
    supa(orgId).from("contacts").select("*").eq("organization_id", orgId),
    supa(orgId).from("queues").select("*").eq("organization_id", orgId),
    supa(orgId).from("tickets").select("*").eq("organization_id", orgId),
    supa(orgId).from("users").select("id, name").eq("organization_id", orgId),
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
  const orgId = requireOrganizationId(organizationId);
  const { data, error } = await supa(orgId)
    .from("conversations")
    .select("*")
    .eq("id", id)
    .eq("organization_id", orgId)
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
  const orgId = requireOrganizationId(organizationId);
  const now = new Date().toISOString();
  await supa(orgId)
    .from("conversations")
    .update({ status: "em_atendimento", updated_at: now })
    .eq("id", conversationId)
    .eq("organization_id", orgId);

  await supa(orgId)
    .from("tickets")
    .update({ assignee_id: userId, first_response_at: now, updated_at: now })
    .eq("conversation_id", conversationId)
    .eq("organization_id", orgId);
}

export async function closeConversation(organizationId: string, conversationId: string, reason: string) {
  const orgId = requireOrganizationId(organizationId);
  const now = new Date().toISOString();
  await supa(orgId)
    .from("conversations")
    .update({ status: "encerrado", closed_at: now, updated_at: now })
    .eq("id", conversationId)
    .eq("organization_id", orgId);

  await supa(orgId)
    .from("tickets")
    .update({ close_reason: reason, closed_at: now, updated_at: now })
    .eq("conversation_id", conversationId)
    .eq("organization_id", orgId);
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
  const orgId = requireOrganizationId(organizationId);
  if (externalId) {
    const { data: dup } = await supa(orgId)
      .from("messages")
      .select("id, content, type, author_id")
      .eq("organization_id", orgId)
      .eq("conversation_id", conversationId)
      .eq("external_id", externalId)
      .maybeSingle();
    if (dup) {
      return {
        id: dup.id,
        organizationId: orgId,
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
  const { error: insertError } = await supa(orgId).from("messages").insert({
    id,
    organization_id: orgId,
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
    await supa(orgId)
      .from("conversations")
      .update({ status: "em_atendimento", updated_at: now })
      .eq("id", conversationId)
      .eq("organization_id", orgId);
  } else {
    await supa(orgId)
      .from("conversations")
      .update({ updated_at: now })
      .eq("id", conversationId)
      .eq("organization_id", orgId);
  }

  return {
    id,
    organizationId: orgId,
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
  const orgId = requireOrganizationId(payload.organizationId);
  const id = randomUUID();
  const { error: insertError } = await supa(orgId).from("messages").insert({
    id,
    organization_id: orgId,
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
  const { error: bumpErr } = await supa(orgId)
    .from("conversations")
    .update({ updated_at: now })
    .eq("id", payload.conversationId)
    .eq("organization_id", orgId);
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
  const orgId = requireOrganizationId(organizationId);
  const { data, error } = await supa(orgId)
    .from("messages")
    .select("id, conversation_id")
    .eq("organization_id", orgId)
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
  const orgId = requireOrganizationId(organizationId);
  const { data } = await supa(orgId)
    .from("messages")
    .select("cloudinary_public_id")
    .eq("organization_id", orgId)
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
  const orgId = requireOrganizationId(organizationId);
  const { data } = await supa(orgId)
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .eq("organization_id", orgId)
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
  const orgId = requireOrganizationId(organizationId);
  const { data } = await supa(orgId)
    .from("contacts")
    .select("*")
    .eq("organization_id", orgId)
    .eq("phone_number", phoneNumber)
    .maybeSingle();
  if (!data) return null;
  return {
    id: String(data.id),
    organizationId: orgId,
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
  const orgId = requireOrganizationId(organizationId);
  const { data: existing } = await supa(orgId)
    .from("contacts")
    .select("*")
    .eq("organization_id", orgId)
    .eq("phone_number", phoneNumber)
    .maybeSingle();

  if (existing) {
    const currentName = String(existing.name ?? "").trim();
    const newName = name.trim();
    const shouldUpdate = newName && !isPlaceholderName(newName) && newName !== currentName;
    if (shouldUpdate) {
      await supa(orgId)
        .from("contacts")
        .update({ name: newName, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .eq("organization_id", orgId);
      return { id: String(existing.id), organizationId: orgId, phoneNumber: String(existing.phone_number), name: newName };
    }
    return {
      id: String(existing.id),
      organizationId: orgId,
      phoneNumber: String(existing.phone_number ?? phoneNumber),
      name: currentName || newName || "Contato",
    };
  }

  const id = randomUUID();
  const finalName = name.trim() || "Contato";
  await supa(orgId).from("contacts").insert({
    id,
    organization_id: orgId,
    phone_number: phoneNumber,
    name: finalName,
  });
  return { id, organizationId: orgId, phoneNumber, name: finalName };
}

export async function updateContactAvatar(
  organizationId: string,
  contactId: string,
  avatarUrl: string | null,
) {
  const orgId = requireOrganizationId(organizationId);
  await supa(orgId)
    .from("contacts")
    .update({ avatar_url: avatarUrl || null, updated_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("organization_id", orgId);
}

export async function listContacts(organizationId: string): Promise<ListContactItem[]> {
  const orgId = requireOrganizationId(organizationId);
  const { data: contactRows, error } = await supa(orgId)
    .from("contacts")
    .select("*")
    .eq("organization_id", orgId);
  if (error) { logger.error({ err: error }, "supa listContacts"); throw error; }
  if (!contactRows || contactRows.length === 0) return [];

  const [{ data: convRows }, { data: msgRows }] = await Promise.all([
    supa(orgId).from("conversations").select("id, contact_id, status, updated_at").eq("organization_id", orgId),
    supa(orgId).from("messages").select("conversation_id, content, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }),
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

/**
 * Página de contatos para a interface operacional. Diferente da listagem
 * legada acima, não transfere todas as conversas e mensagens do tenant para
 * montar a última interação no navegador/servidor de aplicação.
 */
export async function listContactsPage(
  organizationId: string,
  options: { page: number; pageSize: number; query?: string; blocked?: boolean },
): Promise<{ items: ListContactItem[]; total: number }> {
  const orgId = requireOrganizationId(organizationId);
  const page = Math.max(1, options.page);
  const pageSize = Math.min(100, Math.max(1, options.pageSize));
  const offset = (page - 1) * pageSize;
  const values: unknown[] = [orgId];
  const query = options.query?.trim();
  const clauses = ["c.organization_id = $1"];
  if (query) {
    values.push(`%${query}%`);
    const parameter = `$${values.length}`;
    clauses.push(`(c.name ILIKE ${parameter} OR c.phone_number ILIKE ${parameter})`);
  }
  if (typeof options.blocked === "boolean") {
    values.push(options.blocked);
    clauses.push(`c.blocked = $${values.length}`);
  }
  const where = clauses.join(" AND ");
  type ContactPageRow = {
    id: string;
    name: string | null;
    phone_number: string | null;
    blocked: boolean | null;
    internal_note: string | null;
    conversation_id: string | null;
    conversation_status: string | null;
    conversation_updated_at: string | null;
    last_message: string | null;
  };
  const [items, count] = await Promise.all([
    queryTenantDatabase<ContactPageRow>(
      orgId,
      `SELECT c.id, c.name, c.phone_number, c.blocked, c.internal_note,
              latest_conversation.id AS conversation_id,
              latest_conversation.status AS conversation_status,
              latest_conversation.updated_at AS conversation_updated_at,
              latest_message.content AS last_message
         FROM contacts c
         LEFT JOIN LATERAL (
           SELECT id, status, updated_at
             FROM conversations
            WHERE organization_id = c.organization_id
              AND contact_id = c.id
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
         ) latest_conversation ON true
         LEFT JOIN LATERAL (
           SELECT content
             FROM messages
            WHERE organization_id = c.organization_id
              AND conversation_id = latest_conversation.id
            ORDER BY created_at DESC, id DESC
            LIMIT 1
         ) latest_message ON true
        WHERE ${where}
        ORDER BY latest_conversation.updated_at DESC NULLS LAST, c.updated_at DESC, c.id
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, offset],
    ),
    queryTenantDatabase<{ count: string }>(
      orgId,
      `SELECT COUNT(*)::text AS count FROM contacts c WHERE ${where}`,
      values,
    ),
  ]);
  return {
    items: items.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name ?? "Contato"),
      phoneNumber: String(row.phone_number ?? ""),
      lastMessage: row.last_message != null ? String(row.last_message) : null,
      lastInteraction: row.conversation_updated_at ?? null,
      status: row.conversation_id && row.conversation_status !== "encerrado" ? "ativo" : "encerrado",
      blocked: Boolean(row.blocked),
      internalNote: row.internal_note != null ? String(row.internal_note) : null,
      lastConversationId: row.conversation_id != null ? String(row.conversation_id) : null,
    })),
    total: Number(count.rows[0]?.count || 0),
  };
}

export async function updateContact(
  organizationId: string,
  contactId: string,
  payload: { name?: string; phoneNumber?: string; blocked?: boolean; internalNote?: string | null },
) {
  const orgId = requireOrganizationId(organizationId);
  const { data: existing } = await supa(orgId)
    .from("contacts")
    .select("*")
    .eq("id", contactId)
    .eq("organization_id", orgId)
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

  const { data } = await supa(orgId)
    .from("contacts")
    .update(updates)
    .eq("id", contactId)
    .eq("organization_id", orgId)
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
  const orgId = requireOrganizationId(organizationId);
  // 1) Tenta encontrar uma conversa realmente aberta (aguardando / em atendimento / pendente_cliente)
  const { data: openConv } = await supa(orgId)
    .from("conversations")
    .select("*")
    .eq("organization_id", orgId)
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
  const orgId = requireOrganizationId(organizationId);
  return withTenantTransaction(orgId, async (client) => {
    // Serializa somente o par tenant/contato. Assim, dois webhooks ou uma ação
    // manual simultânea não criam conversas/tickets paralelos para o mesmo cliente.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `${orgId}:${contactId}`,
    ]);

    const existingResult = await client.query<Record<string, unknown>>(
      `SELECT id, organization_id, contact_id, contact_phone, queue_id, status, triage_completed, menu_attempts
         FROM conversations
        WHERE organization_id = $1
          AND contact_id = $2
          AND status IN ('aguardando', 'em_atendimento', 'pendente_cliente')
        ORDER BY updated_at DESC
        LIMIT 1
        FOR UPDATE`,
      [orgId, contactId],
    );
    const existing = existingResult.rows[0];
    if (existing) {
      const existingPhone = String(existing.contact_phone || "").trim();
      if (!existingPhone) {
        await client.query(
          `UPDATE conversations
              SET contact_phone = $1, updated_at = now()
            WHERE id = $2 AND organization_id = $3`,
          [contactPhone, existing.id, orgId],
        );
      }
      return {
        id: String(existing.id),
        organizationId: String(existing.organization_id),
        contactId: String(existing.contact_id),
        contactPhone: existingPhone || contactPhone,
        queueId: existing.queue_id ? String(existing.queue_id) : null,
        status: String(existing.status) as ConversationStatus,
        triageCompleted: Boolean(existing.triage_completed),
        menuAttempts: Number(existing.menu_attempts ?? 0),
        isNew: false,
      };
    }

    const convId = randomUUID();
    const ticketId = randomUUID();
    // Nova conversa entra diretamente como "aguardando" para já aparecer na fila,
    // mesmo enquanto o cliente está escolhendo a opção do menu.
    await client.query(
      `INSERT INTO conversations (
         id, organization_id, contact_id, contact_phone, queue_id, status,
         triage_completed, menu_attempts, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, NULL, 'aguardando', false, 0, now(), now())`,
      [convId, orgId, contactId, contactPhone],
    );
    await client.query(
      `INSERT INTO tickets (
         id, organization_id, conversation_id, queue_id, assignee_id, close_reason,
         first_response_at, first_response_due_at, created_at, updated_at, closed_at
       ) VALUES ($1, $2, $3, NULL, NULL, NULL, NULL, NULL, now(), now(), NULL)`,
      [ticketId, orgId, convId],
    );

    return {
      id: convId,
      organizationId: orgId,
      contactId,
      contactPhone,
      queueId: null,
      status: "aguardando" as ConversationStatus,
      triageCompleted: false,
      menuAttempts: 0,
      isNew: true,
    };
  });
}

export async function getOrCreateContactAndOpenConversation(
  organizationId: string,
  contactPhone: string,
  contactName: string,
): Promise<ContactAndConversation> {
  const orgId = requireOrganizationId(organizationId);
  const finalName = contactName.trim() || "Contato";

  // Upsert contact
  const { data: existingContact } = await supa(orgId)
    .from("contacts")
    .select("*")
    .eq("organization_id", orgId)
    .eq("phone_number", contactPhone)
    .maybeSingle();

  let contact: { id: string; organizationId: string; phoneNumber: string; name: string };

  if (existingContact) {
    const currentName = String(existingContact.name ?? "").trim();
    const newName = contactName.trim();
    const shouldUpdate = newName && !isPlaceholderName(newName) && newName !== currentName;
    if (shouldUpdate) {
      await supa(orgId)
        .from("contacts")
        .update({ name: newName, updated_at: new Date().toISOString() })
        .eq("id", existingContact.id)
        .eq("organization_id", orgId);
    }
    contact = {
      id: String(existingContact.id),
      organizationId: orgId,
      phoneNumber: contactPhone,
      name: shouldUpdate ? newName : currentName || newName || "Contato",
    };
  } else {
    const id = randomUUID();
    await supa(orgId).from("contacts").insert({
      id,
      organization_id: orgId,
      phone_number: contactPhone,
      name: finalName,
    });
    contact = { id, organizationId: orgId, phoneNumber: contactPhone, name: finalName };
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
  const orgId = requireOrganizationId(organizationId);
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("status" in payload) updates.status = payload.status;
  if ("queueId" in payload) updates.queue_id = payload.queueId;
  if ("triageCompleted" in payload) updates.triage_completed = payload.triageCompleted;
  if ("menuAttempts" in payload) updates.menu_attempts = payload.menuAttempts;
  if ("contactPhone" in payload) updates.contact_phone = payload.contactPhone;
  await supa(orgId)
    .from("conversations")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", orgId);
}

export async function updateTicketByConversation(
  organizationId: string,
  conversationId: string,
  payload: Record<string, unknown>,
) {
  const orgId = requireOrganizationId(organizationId);
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("queueId" in payload) updates.queue_id = payload.queueId;
  if ("assigneeId" in payload) updates.assignee_id = payload.assigneeId;
  if ("firstResponseDueAt" in payload) {
    updates.first_response_due_at = payload.firstResponseDueAt instanceof Date
      ? payload.firstResponseDueAt.toISOString()
      : payload.firstResponseDueAt;
    // Uma mudança de fila pode conceder um novo prazo. O worker continuará
    // ignorando jobs anteriores e só registrará o vencimento desse novo prazo.
    updates.first_response_sla_breached_at = null;
  }
  if ("firstResponseAt" in payload) updates.first_response_at = payload.firstResponseAt;
  if ("closeReason" in payload) updates.close_reason = payload.closeReason;
  if ("closedAt" in payload) updates.closed_at = payload.closedAt;

  await supa(orgId)
    .from("tickets")
    .update(updates)
    .eq("conversation_id", conversationId)
    .eq("organization_id", orgId);

  if ("firstResponseDueAt" in payload && payload.firstResponseDueAt) {
    const dueAt = new Date(String(payload.firstResponseDueAt));
    if (!Number.isNaN(dueAt.getTime())) {
      void enqueueSlaCheck(organizationId, conversationId, dueAt).catch((error) => {
        logger.error(
          { err: error, organizationId, conversationId },
          "Failed to enqueue first response SLA check",
        );
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function dashboardMetrics(organizationId: string) {
  const orgId = requireOrganizationId(organizationId);
  const [{ data: convRows }, { data: ticketRows }, { data: queueRows }, { data: agentRows }] = await Promise.all([
    supa(orgId).from("conversations").select("status").eq("organization_id", orgId),
    supa(orgId).from("tickets").select("queue_id, created_at, closed_at, first_response_at, first_response_due_at, satisfaction_score").eq("organization_id", orgId),
    supa(orgId).from("queues").select("id, name, color_hex").eq("organization_id", orgId),
    supa(orgId).from("agent_installations").select("status, last_heartbeat_at, last_sync_at").eq("organization_id", orgId),
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
  let resolutionSum = 0;
  let resolutionCount = 0;
  let slaAtRisk = 0;
  let slaOverdue = 0;
  const now = Date.now();

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

    if (t.created_at && t.closed_at) {
      const diff = (new Date(t.closed_at).getTime() - new Date(t.created_at).getTime()) / 60000;
      if (Number.isFinite(diff) && diff >= 0) {
        resolutionSum += diff;
        resolutionCount++;
      }
    }

    if (!t.first_response_at && !t.closed_at && t.first_response_due_at) {
      const dueAt = new Date(t.first_response_due_at).getTime();
      if (dueAt <= now) slaOverdue++;
      else if (dueAt - now <= 15 * 60 * 1000) slaAtRisk++;
    }

    if (typeof t.satisfaction_score === "number" && t.satisfaction_score >= 1 && t.satisfaction_score <= 5) {
      ratingSum += t.satisfaction_score;
      ratingCount++;
    }
  }

  let agentsOnline = 0;
  let lastDataSyncAt: string | null = null;
  for (const agent of agentRows ?? []) {
    const heartbeatAt = agent.last_heartbeat_at ? new Date(agent.last_heartbeat_at).getTime() : 0;
    if (String(agent.status || "").toLowerCase() === "online" && heartbeatAt > now - 5 * 60 * 1000) agentsOnline++;
    if (agent.last_sync_at) {
      const syncAt = new Date(agent.last_sync_at).toISOString();
      if (!lastDataSyncAt || syncAt > lastDataSyncAt) lastDataSyncAt = syncAt;
    }
  }

  return {
    totalAguardando,
    totalAtendimento,
    totalEncerrado,
    firstResponseAverageMinutes: responseCount > 0 ? Math.round(responseSum / responseCount) : null,
    resolutionAverageMinutes: resolutionCount > 0 ? Math.round(resolutionSum / resolutionCount) : null,
    slaAtRisk,
    slaOverdue,
    agentsOnline,
    lastDataSyncAt,
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
  const orgId = requireOrganizationId(organizationId);
  const { data } = await supa(orgId)
    .from("business_hours")
    .select("*")
    .eq("organization_id", orgId)
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
  const { data } = await platformSupa()
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
 * no inbox, mesmo com o WhatsApp conectado. O bootstrap cria a organização com
 * `ON CONFLICT DO NOTHING`, então uma execução antiga com outro valor de
 * DEFAULT_ORG_ID deixa uma organização "órfã" sem usuário nenhum — por isso o
 * sinal mais confiável não é "só existe uma organização", e sim "só uma
 * organização tem usuários cadastrados". Quando o candidato não é essa
 * organização, autocorrigimos e avisamos alto no log.
 */
export async function resolveDefaultOrganizationId(candidateOrgId: string): Promise<string> {
  const now = Date.now();
  if (resolvedOrgIdCache && resolvedOrgIdCache.expiresAt > now) {
    return resolvedOrgIdCache.value;
  }

  const [orgsResult, usersResult] = await Promise.all([
    platformSupa().from("organizations").select("id"),
    platformSupa().from("users").select("organization_id"),
  ]);
  if (orgsResult.error || !orgsResult.data) {
    logger.error(
      { err: orgsResult.error, candidateOrgId },
      "resolveDefaultOrganizationId: falha ao listar organizations; mantendo valor configurado",
    );
    return candidateOrgId;
  }

  const knownOrgIds = orgsResult.data.map((row) => String(row.id));
  const orgsWithUsers = Array.from(
    new Set((usersResult.data ?? []).map((row) => String(row.organization_id))),
  );

  let resolved = candidateOrgId;
  if (!orgsWithUsers.includes(candidateOrgId)) {
    if (orgsWithUsers.length === 1) {
      resolved = orgsWithUsers[0];
      logger.error(
        { configuredOrgId: candidateOrgId, actualOrgId: resolved },
        "DEFAULT_ORG_ID aponta para uma organizacao sem usuarios cadastrados; usando a unica organizacao que possui usuarios. Corrija a variavel de ambiente DEFAULT_ORG_ID para eliminar este aviso.",
      );
    } else if (!knownOrgIds.includes(candidateOrgId) && knownOrgIds.length === 1) {
      resolved = knownOrgIds[0];
      logger.error(
        { configuredOrgId: candidateOrgId, actualOrgId: resolved },
        "DEFAULT_ORG_ID não corresponde a nenhuma organizacao existente no banco; usando a unica organizacao encontrada. Corrija a variavel de ambiente DEFAULT_ORG_ID para eliminar este aviso.",
      );
    } else {
      logger.error(
        { configuredOrgId: candidateOrgId, knownOrgIds, orgsWithUsers },
        "DEFAULT_ORG_ID pode estar incorreto e nao foi possivel autocorrigir com seguranca (organizacoes ambiguas). Mensagens do WhatsApp podem ficar invisiveis no painel ate a variavel ser corrigida manualmente.",
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
  const orgId = requireOrganizationId(organizationId);
  const body = (rawBody || "").trim();
  if (!/^[1-5]$/.test(body)) return false;
  const score = Number(body);

  // 1) Localiza contato pelo telefone
  const { data: contact } = await supa(orgId)
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("phone_number", phoneNumber)
    .maybeSingle();
  if (!contact) return false;

  // 2) Pega a última conversa encerrada desse contato
  const { data: conv } = await supa(orgId)
    .from("conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("contact_id", contact.id)
    .eq("status", "encerrado")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conv) return false;

  // 3) Atualiza o ticket vinculado com a nota (sem sobrescrever se já existir)
  const { data: ticket } = await supa(orgId)
    .from("tickets")
    .select("id, satisfaction_score")
    .eq("organization_id", orgId)
    .eq("conversation_id", conv.id)
    .limit(1)
    .maybeSingle();
  if (!ticket) return false;
  if (typeof ticket.satisfaction_score === "number") {
    // Já tinha nota, não sobrescreve
    return false;
  }

  const { error } = await supa(orgId)
    .from("tickets")
    .update({ satisfaction_score: score, satisfaction_rated_at: new Date().toISOString() })
    .eq("id", ticket.id)
    .eq("organization_id", orgId);

  if (error) {
    logger.error({ err: error, organizationId, phoneNumber }, "Failed to record satisfaction rating");
    return false;
  }

  return true;
}
