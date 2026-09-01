import { queryTenantDatabase } from "@/lib/db";

export type PersonalItemKind = "note" | "task" | "link";
export type PersonalItemStatus = "open" | "done";
export type PersonalItemPriority = "low" | "normal" | "high";

export type PersonalWorkspaceItem = {
  id: string;
  kind: PersonalItemKind;
  title: string;
  content: string;
  url: string | null;
  status: PersonalItemStatus;
  priority: PersonalItemPriority;
  dueAt: string | null;
  isPinned: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type PersonalWorkspaceItemInput = Omit<PersonalWorkspaceItem, "id" | "createdAt" | "updatedAt">;

type PersonalItemRow = {
  id: string; kind: PersonalItemKind; title: string; content: string | null; url: string | null;
  status: PersonalItemStatus; priority: PersonalItemPriority; due_at: string | null; is_pinned: boolean;
  tags: string[] | null; created_at: string; updated_at: string;
};

function mapItem(row: PersonalItemRow): PersonalWorkspaceItem {
  return { id: row.id, kind: row.kind, title: row.title, content: row.content || "", url: row.url,
    status: row.status, priority: row.priority, dueAt: row.due_at, isPinned: Boolean(row.is_pinned),
    tags: Array.isArray(row.tags) ? row.tags : [], createdAt: row.created_at, updatedAt: row.updated_at };
}

const returning = "id, kind, title, content, url, status, priority, due_at, is_pinned, tags, created_at, updated_at";

export async function listPersonalWorkspaceItems(organizationId: string, userId: string): Promise<PersonalWorkspaceItem[]> {
  const result = await queryTenantDatabase<PersonalItemRow>(organizationId,
    "SELECT " + returning + " FROM personal_workspace_items WHERE organization_id = $1 AND owner_user_id = $2 " +
    "ORDER BY is_pinned DESC, CASE WHEN status = 'open' THEN 0 ELSE 1 END, updated_at DESC", [organizationId, userId]);
  return result.rows.map(mapItem);
}

export async function createPersonalWorkspaceItem(organizationId: string, userId: string, input: PersonalWorkspaceItemInput): Promise<PersonalWorkspaceItem> {
  const result = await queryTenantDatabase<PersonalItemRow>(organizationId,
    "INSERT INTO personal_workspace_items (organization_id, owner_user_id, kind, title, content, url, status, priority, due_at, is_pinned, tags) " +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING " + returning,
    [organizationId, userId, input.kind, input.title, input.content, input.url, input.status, input.priority, input.dueAt, input.isPinned, input.tags]);
  return mapItem(result.rows[0]);
}

export async function updatePersonalWorkspaceItem(
  organizationId: string, userId: string, id: string, input: Partial<PersonalWorkspaceItemInput>,
): Promise<PersonalWorkspaceItem | null> {
  const fields: Array<[string, unknown]> = [];
  if (input.kind !== undefined) fields.push(["kind", input.kind]);
  if (input.title !== undefined) fields.push(["title", input.title]);
  if (input.content !== undefined) fields.push(["content", input.content]);
  if (input.url !== undefined) fields.push(["url", input.url]);
  if (input.status !== undefined) fields.push(["status", input.status]);
  if (input.priority !== undefined) fields.push(["priority", input.priority]);
  if (input.dueAt !== undefined) fields.push(["due_at", input.dueAt]);
  if (input.isPinned !== undefined) fields.push(["is_pinned", input.isPinned]);
  if (input.tags !== undefined) fields.push(["tags", input.tags]);
  if (!fields.length) return null;
  const values: unknown[] = [organizationId, userId, id];
  const assignments = fields.map(([column, value]) => { values.push(value); return column + " = $" + values.length; });
  assignments.push("updated_at = now()");
  const result = await queryTenantDatabase<PersonalItemRow>(organizationId,
    "UPDATE personal_workspace_items SET " + assignments.join(", ") +
    " WHERE organization_id = $1 AND owner_user_id = $2 AND id = $3 RETURNING " + returning, values);
  return result.rows[0] ? mapItem(result.rows[0]) : null;
}

export async function deletePersonalWorkspaceItem(organizationId: string, userId: string, id: string): Promise<boolean> {
  const result = await queryTenantDatabase<{ id: string }>(organizationId,
    "DELETE FROM personal_workspace_items WHERE organization_id = $1 AND owner_user_id = $2 AND id = $3 RETURNING id",
    [organizationId, userId, id]);
  return result.rowCount > 0;
}
