import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getDatabasePool, queryDatabase, withTenantTransaction } from "@/lib/db";
import {
  decryptAgentSecret,
  encryptAgentSecret,
} from "@/lib/agent-cloud/agent-signature";
import type {
  AgentContext,
  AgentInstallation,
  ProvisionedAgentCredential,
} from "@/lib/agent-cloud/types";

type AgentRow = {
  id: string;
  organization_id: string;
  name: string;
  installation_key: string;
  status: AgentInstallation["status"];
  agent_version: string | null;
  schema_version: string | null;
  last_heartbeat_at: Date | null;
  last_sync_at: Date | null;
  last_error_code: string | null;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapAgent(row: AgentRow): AgentInstallation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    installationKey: row.installation_key,
    status: row.status,
    agentVersion: row.agent_version,
    schemaVersion: row.schema_version,
    lastHeartbeatAt: row.last_heartbeat_at?.toISOString() || null,
    lastSyncAt: row.last_sync_at?.toISOString() || null,
    lastErrorCode: row.last_error_code,
    revokedAt: row.revoked_at?.toISOString() || null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function newInstallationKey(): string {
  return `agt_${randomBytes(18).toString("base64url")}`;
}

function newAgentSecret(): string {
  return `mavo_${randomBytes(32).toString("base64url")}`;
}

async function insertCredential(
  client: PoolClient,
  agentId: string,
  secret: string,
  keyVersion: number,
): Promise<void> {
  const encrypted = encryptAgentSecret(secret);
  await client.query(
    `INSERT INTO agent_credentials (
       id, agent_id, secret_ciphertext, secret_iv, secret_auth_tag,
       secret_fingerprint, key_version
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      randomUUID(),
      agentId,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      encrypted.fingerprint,
      keyVersion,
    ],
  );
}

export async function provisionAgent(input: {
  organizationId: string;
  name: string;
  createdByUserId: string;
}): Promise<ProvisionedAgentCredential> {
  return withTenantTransaction(input.organizationId, async (client) => {
    const installationKey = newInstallationKey();
    const secret = newAgentSecret();
    const result = await client.query<AgentRow>(
      `INSERT INTO agent_installations (
         id, organization_id, name, installation_key, created_by_user_id
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        randomUUID(),
        input.organizationId,
        input.name.trim(),
        installationKey,
        input.createdByUserId,
      ],
    );
    await insertCredential(client, result.rows[0].id, secret, 1);
    return {
      agent: mapAgent(result.rows[0]),
      agentId: installationKey,
      secret,
      keyVersion: 1,
    };
  });
}

export async function rotateAgentCredential(
  organizationId: string,
  agentId: string,
): Promise<ProvisionedAgentCredential | null> {
  return withTenantTransaction(organizationId, async (client) => {
    const agentResult = await client.query<AgentRow>(
      `SELECT *
         FROM agent_installations
        WHERE organization_id = $1 AND id = $2
          AND revoked_at IS NULL
        FOR UPDATE`,
      [organizationId, agentId],
    );
    const row = agentResult.rows[0];
    if (!row) return null;
    const versionResult = await client.query<{ version: number }>(
      `SELECT COALESCE(MAX(key_version), 0)::int + 1 AS version
         FROM agent_credentials
        WHERE agent_id = $1`,
      [agentId],
    );
    const version = versionResult.rows[0].version;
    await client.query(
      `UPDATE agent_credentials
          SET revoked_at = now()
        WHERE agent_id = $1 AND revoked_at IS NULL`,
      [agentId],
    );
    const secret = newAgentSecret();
    await insertCredential(client, agentId, secret, version);
    await client.query(
      `UPDATE agent_installations SET updated_at = now() WHERE id = $1`,
      [agentId],
    );
    return {
      agent: mapAgent(row),
      agentId: row.installation_key,
      secret,
      keyVersion: version,
    };
  });
}

export async function revokeAgent(
  organizationId: string,
  agentId: string,
): Promise<boolean> {
  return withTenantTransaction(organizationId, async (client) => {
    const result = await client.query(
      `UPDATE agent_installations
          SET status = 'revoked', revoked_at = now(), updated_at = now()
        WHERE organization_id = $1 AND id = $2 AND revoked_at IS NULL`,
      [organizationId, agentId],
    );
    if (result.rowCount !== 1) return false;
    await client.query(
      `UPDATE agent_credentials
          SET revoked_at = now()
        WHERE agent_id = $1 AND revoked_at IS NULL`,
      [agentId],
    );
    return true;
  });
}

export async function getAgentCredential(
  installationKey: string,
): Promise<{
  agentId: string;
  installationKey: string;
  organizationId: string;
  agentName: string;
  keyVersion: number;
  secret: string;
} | null> {
  const result = await queryDatabase<{
    agent_id: string;
    installation_key: string;
    organization_id: string;
    agent_name: string;
    key_version: number;
    secret_ciphertext: string;
    secret_iv: string;
    secret_auth_tag: string;
  }>(
    `SELECT ai.id AS agent_id, ai.installation_key, ai.organization_id,
            ai.name AS agent_name, ac.key_version, ac.secret_ciphertext,
            ac.secret_iv, ac.secret_auth_tag
       FROM agent_installations ai
       JOIN agent_credentials ac ON ac.agent_id = ai.id
      WHERE ai.installation_key = $1
        AND ai.revoked_at IS NULL
        AND ai.status <> 'revoked'
        AND ac.revoked_at IS NULL
        AND (ac.expires_at IS NULL OR ac.expires_at > now())
      ORDER BY ac.key_version DESC
      LIMIT 1`,
    [installationKey],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    agentId: row.agent_id,
    installationKey: row.installation_key,
    organizationId: row.organization_id,
    agentName: row.agent_name,
    keyVersion: row.key_version,
    secret: decryptAgentSecret({
      ciphertext: row.secret_ciphertext,
      iv: row.secret_iv,
      authTag: row.secret_auth_tag,
    }),
  };
}

export async function reserveNonceInDatabase(
  agentId: string,
  nonce: string,
  expiresAt: Date,
): Promise<boolean> {
  const pool = getDatabasePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM agent_nonces WHERE agent_id = $1 AND expires_at <= now()",
      [agentId],
    );
    const result = await client.query(
      `INSERT INTO agent_nonces (agent_id, nonce, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (agent_id, nonce) DO NOTHING`,
      [agentId, nonce, expiresAt],
    );
    await client.query("COMMIT");
    return result.rowCount === 1;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateAgentHeartbeat(
  context: AgentContext,
  input: {
    agentVersion: string;
    schemaVersion: string;
    degraded: boolean;
    errorCode?: string | null;
  },
): Promise<void> {
  await queryDatabase(
    `UPDATE agent_installations
        SET status = $3,
            agent_version = $4,
            schema_version = $5,
            last_heartbeat_at = now(),
            last_ip = $6::inet,
            last_error_code = $7,
            updated_at = now()
      WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL`,
    [
      context.agentId,
      context.organizationId,
      input.degraded ? "error" : "online",
      input.agentVersion,
      input.schemaVersion,
      context.sourceIp,
      input.errorCode || null,
    ],
  );
}

export async function listAgents(
  organizationId: string,
  options: { page: number; pageSize: number },
): Promise<{
  items: Array<AgentInstallation & { receivedRecords: number; lastBatchError: string | null }>;
  total: number;
}> {
  const offset = (options.page - 1) * options.pageSize;
  const [result, count] = await Promise.all([
    queryDatabase<
      AgentRow & { received_records: string; last_batch_error: string | null }
    >(
      `SELECT ai.*,
              COALESCE(SUM(asb.item_count), 0)::text AS received_records,
              (
                SELECT error_summary
                  FROM agent_sync_batches latest
                 WHERE latest.agent_id = ai.id
                   AND latest.status IN ('failed', 'rejected')
                 ORDER BY latest.received_at DESC
                 LIMIT 1
              ) AS last_batch_error
         FROM agent_installations ai
         LEFT JOIN agent_sync_batches asb ON asb.agent_id = ai.id
        WHERE ai.organization_id = $1
        GROUP BY ai.id
        ORDER BY ai.created_at DESC
        LIMIT $2 OFFSET $3`,
      [organizationId, options.pageSize, offset],
    ),
    queryDatabase<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM agent_installations
        WHERE organization_id = $1`,
      [organizationId],
    ),
  ]);
  return {
    items: result.rows.map((row) => ({
      ...mapAgent(row),
      receivedRecords: Number(row.received_records || 0),
      lastBatchError: row.last_batch_error,
    })),
    total: Number(count.rows[0]?.count || 0),
  };
}

export async function recordAgentAudit(input: {
  context?: AgentContext;
  organizationId: string;
  agentId?: string | null;
  batchId?: string | null;
  requestId: string;
  eventType: string;
  status: "success" | "rejected" | "failed";
  errorCode?: string | null;
  durationMs?: number;
  sourceIp?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  await queryDatabase(
    `INSERT INTO agent_audit_events (
       id, organization_id, agent_id, batch_id, request_id, event_type,
       status, error_code, duration_ms, source_ip, metadata
     )
     VALUES ($1, $2, $3, $4::uuid, $5, $6, $7, $8, $9, $10::inet, $11::jsonb)`,
    [
      randomUUID(),
      input.organizationId,
      input.context?.agentId || input.agentId || null,
      input.batchId || null,
      input.requestId,
      input.eventType,
      input.status,
      input.errorCode || null,
      input.durationMs ?? null,
      input.context?.sourceIp || input.sourceIp || null,
      JSON.stringify(input.metadata || {}),
    ],
  );
}

export function databasePoolForAgentIngestion() {
  return getDatabasePool();
}
