import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { queryTenantDatabase, withTenantTransaction } from "@/lib/db";
import type {
  BusinessAccessSession,
  BusinessAccessUser,
  BusinessMfaType,
  BusinessPermission,
  BusinessRole,
} from "@/lib/business-access/types";
import { nextPinFailureState } from "@/lib/business-access/business-pin-policy";

type UserRow = {
  id: string;
  organization_id: string;
  name: string;
  phone_normalized: string;
  role: BusinessRole;
  permissions: Partial<Record<BusinessPermission, boolean>> | null;
  pin_hash: string | null;
  mfa_type: BusinessMfaType;
  is_active: boolean;
  failed_attempts: number;
  locked_until: Date | null;
  last_access_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type SessionRow = {
  id: string;
  organization_id: string;
  access_user_id: string;
  phone_normalized: string;
  authenticated_at: Date;
  last_activity_at: Date;
  expires_at: Date;
  support_mode_until: Date | null;
  revoked_at: Date | null;
};

function mapUser(row: UserRow): BusinessAccessUser {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    phoneNormalized: row.phone_normalized,
    role: row.role,
    permissions: row.permissions || {},
    pinHash: row.pin_hash,
    mfaType: row.mfa_type,
    isActive: row.is_active,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    lastAccessAt: row.last_access_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSession(row: SessionRow): BusinessAccessSession {
  return {
    id: row.id,
    organizationId: row.organization_id,
    accessUserId: row.access_user_id,
    phoneNormalized: row.phone_normalized,
    authenticatedAt: row.authenticated_at,
    lastActivityAt: row.last_activity_at,
    expiresAt: row.expires_at,
    supportModeUntil: row.support_mode_until,
    revokedAt: row.revoked_at,
  };
}

export async function findBusinessAccessUserByPhone(
  organizationId: string,
  phoneNormalized: string,
): Promise<BusinessAccessUser | null> {
  const result = await queryTenantDatabase<UserRow>(
    organizationId,
    `SELECT *
       FROM business_access_users
      WHERE organization_id = $1
        AND phone_normalized = $2
      LIMIT 1`,
    [organizationId, phoneNormalized],
  );
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function getBusinessAccessUser(
  organizationId: string,
  accessUserId: string,
): Promise<BusinessAccessUser | null> {
  const result = await queryTenantDatabase<UserRow>(
    organizationId,
    `SELECT *
       FROM business_access_users
      WHERE organization_id = $1 AND id = $2
      LIMIT 1`,
    [organizationId, accessUserId],
  );
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function listBusinessAccessUsers(
  organizationId: string,
  options: { page: number; pageSize: number },
): Promise<{ items: BusinessAccessUser[]; total: number }> {
  const offset = (options.page - 1) * options.pageSize;
  const [items, count] = await Promise.all([
    queryTenantDatabase<UserRow>(
      organizationId,
      `SELECT *
         FROM business_access_users
        WHERE organization_id = $1
        ORDER BY name, id
        LIMIT $2 OFFSET $3`,
      [organizationId, options.pageSize, offset],
    ),
    queryTenantDatabase<{ count: string }>(
      organizationId,
      `SELECT COUNT(*)::text AS count
         FROM business_access_users
        WHERE organization_id = $1`,
      [organizationId],
    ),
  ]);
  return {
    items: items.rows.map(mapUser),
    total: Number(count.rows[0]?.count || 0),
  };
}

export async function createBusinessAccessUser(input: {
  organizationId: string;
  name: string;
  phoneNormalized: string;
  role: BusinessRole;
  permissions: Partial<Record<BusinessPermission, boolean>>;
  pinHash: string;
  mfaType?: BusinessMfaType;
  createdByUserId?: string;
}): Promise<BusinessAccessUser> {
  const result = await queryTenantDatabase<UserRow>(
    input.organizationId,
    `INSERT INTO business_access_users (
       id, organization_id, name, phone_normalized, role, permissions,
       pin_hash, mfa_type, pin_changed_at, created_by_user_id
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now(), $9)
     RETURNING *`,
    [
      randomUUID(),
      input.organizationId,
      input.name.trim(),
      input.phoneNormalized,
      input.role,
      JSON.stringify(input.permissions),
      input.pinHash,
      input.mfaType || "pin",
      input.createdByUserId || null,
    ],
  );
  return mapUser(result.rows[0]);
}

export async function updateBusinessAccessUser(
  organizationId: string,
  accessUserId: string,
  input: Partial<{
    name: string;
    phoneNormalized: string;
    role: BusinessRole;
    permissions: Partial<Record<BusinessPermission, boolean>>;
    isActive: boolean;
    pinHash: string;
    mfaType: BusinessMfaType;
  }>,
): Promise<BusinessAccessUser | null> {
  const columns: string[] = [];
  const values: unknown[] = [organizationId, accessUserId];
  const add = (column: string, value: unknown, cast = "") => {
    values.push(value);
    columns.push(`${column} = $${values.length}${cast}`);
  };
  if (input.name !== undefined) add("name", input.name.trim());
  if (input.phoneNormalized !== undefined) {
    add("phone_normalized", input.phoneNormalized);
  }
  if (input.role !== undefined) add("role", input.role);
  if (input.permissions !== undefined) {
    add("permissions", JSON.stringify(input.permissions), "::jsonb");
  }
  if (input.isActive !== undefined) add("is_active", input.isActive);
  if (input.pinHash !== undefined) {
    add("pin_hash", input.pinHash);
    columns.push("pin_changed_at = now()");
    columns.push("failed_attempts = 0");
    columns.push("locked_until = NULL");
  }
  if (input.mfaType !== undefined) add("mfa_type", input.mfaType);
  if (!columns.length) return getBusinessAccessUser(organizationId, accessUserId);
  columns.push("updated_at = now()");

  const result = await queryTenantDatabase<UserRow>(
    organizationId,
    `UPDATE business_access_users
        SET ${columns.join(", ")}
      WHERE organization_id = $1 AND id = $2
      RETURNING *`,
    values,
  );
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function registerFailedPinAttempt(
  organizationId: string,
  accessUserId: string,
  maxAttempts: number,
  lockMinutes: number,
): Promise<{ failedAttempts: number; lockedUntil: Date | null }> {
  return withTenantTransaction(organizationId, async (client) => {
    const current = await client.query<{
      failed_attempts: number;
      locked_until: Date | null;
    }>(
      `SELECT failed_attempts, locked_until
         FROM business_access_users
        WHERE organization_id = $1 AND id = $2
        FOR UPDATE`,
      [organizationId, accessUserId],
    );
    const row = current.rows[0];
    if (!row) return { failedAttempts: 0, lockedUntil: null };
    const next = nextPinFailureState({
      currentFailedAttempts: row.failed_attempts,
      currentLockedUntil: row.locked_until,
      maxAttempts,
      lockMinutes,
    });
    await client.query(
      `UPDATE business_access_users
          SET failed_attempts = $3,
              locked_until = $4,
              updated_at = now()
        WHERE organization_id = $1 AND id = $2`,
      [
        organizationId,
        accessUserId,
        next.failedAttempts,
        next.lockedUntil,
      ],
    );
    return next;
  });
}

export async function resetPinAttempts(
  organizationId: string,
  accessUserId: string,
): Promise<void> {
  await queryTenantDatabase(
    organizationId,
    `UPDATE business_access_users
        SET failed_attempts = 0, locked_until = NULL,
            last_access_at = now(), updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, accessUserId],
  );
}

export async function unlockBusinessAccessUser(
  organizationId: string,
  accessUserId: string,
): Promise<boolean> {
  const result = await queryTenantDatabase(
    organizationId,
    `UPDATE business_access_users
        SET failed_attempts = 0, locked_until = NULL, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, accessUserId],
  );
  return result.rowCount === 1;
}

export async function createBusinessSession(input: {
  organizationId: string;
  accessUserId: string;
  phoneNormalized: string;
  tokenHash: string;
  ttlMinutes: number;
}): Promise<BusinessAccessSession> {
  return withTenantTransaction(input.organizationId, async (client) => {
    await client.query(
      `UPDATE business_access_sessions
          SET revoked_at = now(), revoke_reason = 'replaced'
        WHERE organization_id = $1
          AND access_user_id = $2
          AND revoked_at IS NULL`,
      [input.organizationId, input.accessUserId],
    );
    const result = await client.query<SessionRow>(
      `INSERT INTO business_access_sessions (
         id, organization_id, access_user_id, phone_normalized,
         session_token_hash, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6))
       RETURNING *`,
      [
        randomUUID(),
        input.organizationId,
        input.accessUserId,
        input.phoneNormalized,
        input.tokenHash,
        input.ttlMinutes,
      ],
    );
    return mapSession(result.rows[0]);
  });
}

export async function findActiveBusinessSession(
  organizationId: string,
  phoneNormalized: string,
): Promise<{
  session: BusinessAccessSession;
  user: BusinessAccessUser;
} | null> {
  const result = await queryTenantDatabase<
    SessionRow & {
      user_id: string;
      user_organization_id: string;
      user_name: string;
      user_phone_normalized: string;
      user_role: BusinessRole;
      user_permissions: Partial<Record<BusinessPermission, boolean>>;
      user_pin_hash: string | null;
      user_mfa_type: BusinessMfaType;
      user_is_active: boolean;
      user_failed_attempts: number;
      user_locked_until: Date | null;
      user_last_access_at: Date | null;
      user_created_at: Date;
      user_updated_at: Date;
    }
  >(
    organizationId,
    `SELECT s.*,
            u.id AS user_id,
            u.organization_id AS user_organization_id,
            u.name AS user_name,
            u.phone_normalized AS user_phone_normalized,
            u.role AS user_role,
            u.permissions AS user_permissions,
            u.pin_hash AS user_pin_hash,
            u.mfa_type AS user_mfa_type,
            u.is_active AS user_is_active,
            u.failed_attempts AS user_failed_attempts,
            u.locked_until AS user_locked_until,
            u.last_access_at AS user_last_access_at,
            u.created_at AS user_created_at,
            u.updated_at AS user_updated_at
       FROM business_access_sessions s
       JOIN business_access_users u
         ON u.id = s.access_user_id
        AND u.organization_id = s.organization_id
      WHERE s.organization_id = $1
        AND s.phone_normalized = $2
        AND s.revoked_at IS NULL
        AND (
          s.expires_at > now()
          OR s.support_mode_until > now()
        )
        AND u.is_active = true
      ORDER BY s.authenticated_at DESC
      LIMIT 1`,
    [organizationId, phoneNormalized],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    session: mapSession(row),
    user: mapUser({
      id: row.user_id,
      organization_id: row.user_organization_id,
      name: row.user_name,
      phone_normalized: row.user_phone_normalized,
      role: row.user_role,
      permissions: row.user_permissions,
      pin_hash: row.user_pin_hash,
      mfa_type: row.user_mfa_type,
      is_active: row.user_is_active,
      failed_attempts: row.user_failed_attempts,
      locked_until: row.user_locked_until,
      last_access_at: row.user_last_access_at,
      created_at: row.user_created_at,
      updated_at: row.user_updated_at,
    }),
  };
}

export async function renewBusinessSession(
  organizationId: string,
  sessionId: string,
  ttlMinutes: number,
): Promise<BusinessAccessSession | null> {
  const result = await queryTenantDatabase<SessionRow>(
    organizationId,
    `UPDATE business_access_sessions
        SET last_activity_at = now(),
            expires_at = now() + make_interval(mins => $3)
      WHERE organization_id = $1
        AND id = $2
        AND revoked_at IS NULL
        AND expires_at > now()
      RETURNING *`,
    [organizationId, sessionId, ttlMinutes],
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function revokeBusinessSessions(
  organizationId: string,
  accessUserId: string,
  reason: string,
): Promise<number> {
  const result = await queryTenantDatabase(
    organizationId,
    `UPDATE business_access_sessions
        SET revoked_at = now(), revoke_reason = $3
      WHERE organization_id = $1
        AND access_user_id = $2
        AND revoked_at IS NULL`,
    [organizationId, accessUserId, reason.slice(0, 200)],
  );
  return result.rowCount || 0;
}

export async function startBusinessSupportMode(
  organizationId: string,
  sessionId: string,
  durationMinutes = 1_440,
): Promise<void> {
  await queryTenantDatabase(
    organizationId,
    `UPDATE business_access_sessions
        SET support_mode_until = now() + make_interval(mins => $3),
            last_activity_at = now()
      WHERE organization_id = $1
        AND id = $2
        AND revoked_at IS NULL
        AND expires_at > now()`,
    [organizationId, sessionId, durationMinutes],
  );
}

export async function endBusinessSupportMode(
  organizationId: string,
  phoneNormalized: string,
): Promise<void> {
  await queryTenantDatabase(
    organizationId,
    `UPDATE business_access_sessions
        SET support_mode_until = NULL, last_activity_at = now()
      WHERE organization_id = $1
        AND phone_normalized = $2
        AND revoked_at IS NULL`,
    [organizationId, phoneNormalized],
  );
}

export async function recordBusinessAccessAudit(input: {
  organizationId: string;
  accessUserId?: string | null;
  phoneNormalized?: string | null;
  eventType: string;
  source?: "whatsapp" | "ui" | "api" | "system";
  requestId?: string;
  metadata?: Record<string, string | number | boolean | null>;
  client?: PoolClient;
}): Promise<void> {
  const values = [
    randomUUID(),
    input.organizationId,
    input.accessUserId || null,
    input.phoneNormalized || null,
    input.eventType,
    input.source || "whatsapp",
    input.requestId || null,
    JSON.stringify(input.metadata || {}),
  ];
  const sql = `INSERT INTO business_access_audit (
      id, organization_id, access_user_id, phone_normalized,
      event_type, source, request_id, metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`;
  if (input.client) await input.client.query(sql, values);
  else await queryTenantDatabase(input.organizationId, sql, values);
}

export async function reserveBusinessWhatsappEvent(input: {
  organizationId: string;
  accessUserId: string;
  phoneNormalized: string;
  eventId?: string;
}): Promise<boolean> {
  if (!input.eventId) return true;
  const result = await queryTenantDatabase(
    input.organizationId,
    `INSERT INTO business_whatsapp_events (
       id, organization_id, event_id, access_user_id, phone_normalized
     )
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (organization_id, event_id) DO NOTHING`,
    [
      randomUUID(),
      input.organizationId,
      input.eventId.slice(0, 500),
      input.accessUserId,
      input.phoneNormalized,
    ],
  );
  return result.rowCount === 1;
}
