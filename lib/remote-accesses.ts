import { queryTenantDatabase } from "@/lib/db";
import { decryptRemoteAccessSecret, encryptRemoteAccessSecret } from "@/lib/remote-access-vault";

export type RemoteAccessProvider = "anydesk" | "teamviewer" | "other";
export type RemoteAccess = {
  id: string; provider: RemoteAccessProvider; label: string; address: string; username: string | null;
  location: string | null; responsibleName: string | null; notes: string; tags: string[];
  isActive: boolean; hasSecret: boolean; createdAt: string; updatedAt: string;
};
export type RemoteAccessInput = Omit<RemoteAccess, "id" | "hasSecret" | "createdAt" | "updatedAt"> & { secret?: string | null };
type RemoteAccessRow = {
  id: string; provider: RemoteAccessProvider; label: string; address: string; username: string | null;
  location: string | null; responsible_name: string | null; notes: string | null; tags: string[] | null;
  is_active: boolean; has_secret: boolean; created_at: string; updated_at: string;
};

function mapAccess(row: RemoteAccessRow): RemoteAccess {
  return { id: row.id, provider: row.provider, label: row.label, address: row.address, username: row.username,
    location: row.location, responsibleName: row.responsible_name, notes: row.notes || "",
    tags: Array.isArray(row.tags) ? row.tags : [], isActive: Boolean(row.is_active), hasSecret: Boolean(row.has_secret),
    createdAt: row.created_at, updatedAt: row.updated_at };
}

const returning = "id, provider, label, address, username, location, responsible_name, notes, tags, is_active, " +
  "(secret_ciphertext IS NOT NULL) AS has_secret, created_at, updated_at";

async function audit(organizationId: string, remoteAccessId: string, userId: string, action: string, metadata: Record<string, unknown> = {}) {
  await queryTenantDatabase(organizationId,
    "INSERT INTO remote_access_audit (organization_id, remote_access_id, user_id, action, metadata) VALUES ($1,$2,$3,$4,$5::jsonb)",
    [organizationId, remoteAccessId, userId, action, JSON.stringify(metadata)]);
}

export async function listRemoteAccesses(organizationId: string): Promise<RemoteAccess[]> {
  const result = await queryTenantDatabase<RemoteAccessRow>(organizationId,
    "SELECT " + returning + " FROM remote_accesses WHERE organization_id = $1 ORDER BY is_active DESC, label ASC", [organizationId]);
  return result.rows.map(mapAccess);
}

export async function createRemoteAccess(organizationId: string, userId: string, input: RemoteAccessInput): Promise<RemoteAccess> {
  const encrypted = input.secret?.trim() ? encryptRemoteAccessSecret(input.secret.trim()) : null;
  const result = await queryTenantDatabase<RemoteAccessRow>(organizationId,
    "INSERT INTO remote_accesses (organization_id, provider, label, address, username, location, responsible_name, notes, tags, is_active, " +
    "secret_ciphertext, secret_iv, secret_auth_tag, secret_key_version, created_by, updated_by) " +
    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING " + returning,
    [organizationId, input.provider, input.label, input.address, input.username, input.location, input.responsibleName,
      input.notes, input.tags, input.isActive, encrypted?.ciphertext ?? null, encrypted?.iv ?? null,
      encrypted?.authTag ?? null, encrypted?.keyVersion ?? null, userId]);
  const item = mapAccess(result.rows[0]);
  await audit(organizationId, item.id, userId, "create", { provider: item.provider, hasSecret: item.hasSecret });
  return item;
}

export async function updateRemoteAccess(organizationId: string, userId: string, id: string, input: Partial<RemoteAccessInput>): Promise<RemoteAccess | null> {
  const fields: Array<[string, unknown]> = [];
  if (input.provider !== undefined) fields.push(["provider", input.provider]);
  if (input.label !== undefined) fields.push(["label", input.label]);
  if (input.address !== undefined) fields.push(["address", input.address]);
  if (input.username !== undefined) fields.push(["username", input.username]);
  if (input.location !== undefined) fields.push(["location", input.location]);
  if (input.responsibleName !== undefined) fields.push(["responsible_name", input.responsibleName]);
  if (input.notes !== undefined) fields.push(["notes", input.notes]);
  if (input.tags !== undefined) fields.push(["tags", input.tags]);
  if (input.isActive !== undefined) fields.push(["is_active", input.isActive]);
  if (input.secret !== undefined) {
    const encrypted = input.secret?.trim() ? encryptRemoteAccessSecret(input.secret.trim()) : null;
    fields.push(["secret_ciphertext", encrypted?.ciphertext ?? null], ["secret_iv", encrypted?.iv ?? null],
      ["secret_auth_tag", encrypted?.authTag ?? null], ["secret_key_version", encrypted?.keyVersion ?? null]);
  }
  if (!fields.length) return null;
  const values: unknown[] = [organizationId, id];
  const assignments = fields.map(([column, value]) => { values.push(value); return column + " = $" + values.length; });
  values.push(userId);
  assignments.push("updated_by = $" + values.length, "updated_at = now()");
  const result = await queryTenantDatabase<RemoteAccessRow>(organizationId,
    "UPDATE remote_accesses SET " + assignments.join(", ") + " WHERE organization_id = $1 AND id = $2 RETURNING " + returning, values);
  if (!result.rows[0]) return null;
  const item = mapAccess(result.rows[0]);
  await audit(organizationId, id, userId, "update", { fieldsChanged: fields.map(([field]) => field), hasSecret: item.hasSecret });
  return item;
}

export async function revealRemoteAccessSecret(organizationId: string, userId: string, id: string): Promise<string | null> {
  const result = await queryTenantDatabase<{ secret_ciphertext: string | null; secret_iv: string | null; secret_auth_tag: string | null }>(
    organizationId,
    "SELECT secret_ciphertext, secret_iv, secret_auth_tag FROM remote_accesses WHERE organization_id = $1 AND id = $2",
    [organizationId, id]);
  const item = result.rows[0];
  if (!item) return null;
  if (!item.secret_ciphertext || !item.secret_iv || !item.secret_auth_tag) return "";
  const secret = decryptRemoteAccessSecret({ ciphertext: item.secret_ciphertext, iv: item.secret_iv, authTag: item.secret_auth_tag });
  await audit(organizationId, id, userId, "reveal_secret");
  return secret;
}
