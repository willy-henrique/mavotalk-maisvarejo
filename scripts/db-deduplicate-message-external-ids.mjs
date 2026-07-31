import { randomUUID } from "node:crypto";
import {
  acquireMigrationLock,
  applyMigrationSessionGuards,
  createMigrationPool,
  releaseMigrationLock,
  runDeployStep,
} from "./db-common.mjs";

const APPLY_CONFIRMATION = "apply";
const confirmation = String(
  process.env.MAVO_CONFIRM_EXTERNAL_ID_DEDUPLICATION || "",
).trim();

async function readDuplicateSummary(client) {
  const result = await client.query(`
    WITH duplicate_groups AS (
      SELECT organization_id, external_id, COUNT(*)::int AS occurrences
        FROM messages
       WHERE external_id IS NOT NULL
       GROUP BY organization_id, external_id
      HAVING COUNT(*) > 1
    )
    SELECT
      COUNT(*)::int AS groups,
      COALESCE(SUM(occurrences), 0)::int AS records,
      COALESCE(SUM(occurrences - 1), 0)::int AS records_to_nullify
      FROM duplicate_groups
  `);
  return result.rows[0] ?? { groups: 0, records: 0, records_to_nullify: 0 };
}

await runDeployStep("db:deduplicate:external-ids", async () => {
  const pool = createMigrationPool();
  const client = await pool.connect();

  try {
    await applyMigrationSessionGuards(client);
    await acquireMigrationLock(client);

    const summary = await readDuplicateSummary(client);
    console.log(
      JSON.stringify(
        {
          mode: confirmation === APPLY_CONFIRMATION ? "apply" : "dry-run",
          duplicateGroups: Number(summary.groups),
          duplicateRecords: Number(summary.records),
          recordsToNullify: Number(summary.records_to_nullify),
          canonicalOrder: "created_at ASC, id ASC",
        },
        null,
        2,
      ),
    );

    if (confirmation !== APPLY_CONFIRMATION) {
      console.log(
        "Dry run concluído. Para aplicar, defina MAVO_CONFIRM_EXTERNAL_ID_DEDUPLICATION=apply.",
      );
      return;
    }

    if (Number(summary.groups) === 0) {
      console.log("Nenhuma duplicidade de external_id encontrada.");
      return;
    }

    const runId = randomUUID();
    await client.query("BEGIN");
    try {
      // Bloqueia escritas concorrentes em messages enquanto o snapshot, a
      // auditoria e a atualização são calculados sobre o mesmo conjunto.
      await client.query("LOCK TABLE messages IN SHARE ROW EXCLUSIVE MODE");

      const lockedSummary = await readDuplicateSummary(client);
      if (
        Number(lockedSummary.groups) !== Number(summary.groups) ||
        Number(lockedSummary.records) !== Number(summary.records) ||
        Number(lockedSummary.records_to_nullify) !==
          Number(summary.records_to_nullify)
      ) {
        throw new Error(
          "O conjunto de duplicidades mudou antes do bloqueio. Nenhuma alteração foi aplicada; execute novamente.",
        );
      }

      await client.query(`
        CREATE TABLE IF NOT EXISTS message_external_id_dedup_runs (
          id TEXT PRIMARY KEY,
          canonical_order TEXT NOT NULL,
          duplicate_groups INTEGER NOT NULL CHECK (duplicate_groups > 0),
          duplicate_records INTEGER NOT NULL CHECK (duplicate_records > 0),
          records_nullified INTEGER NOT NULL CHECK (records_nullified > 0),
          started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          completed_at TIMESTAMPTZ
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS message_external_id_dedup_backups (
          id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES message_external_id_dedup_runs(id) ON DELETE RESTRICT,
          organization_id TEXT NOT NULL REFERENCES organizations(id),
          external_id TEXT NOT NULL,
          message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
          is_canonical BOOLEAN NOT NULL,
          original_message JSONB NOT NULL,
          backed_up_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (run_id, message_id)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS message_external_id_dedup_audit (
          id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES message_external_id_dedup_runs(id) ON DELETE RESTRICT,
          organization_id TEXT NOT NULL REFERENCES organizations(id),
          external_id TEXT NOT NULL,
          message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
          canonical_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
          action TEXT NOT NULL CHECK (action = 'external_id_nullified'),
          previous_external_id TEXT NOT NULL,
          new_external_id TEXT,
          selection_rule TEXT NOT NULL,
          changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (new_external_id IS NULL)
        )
      `);
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_message_external_id_dedup_backups_run ON message_external_id_dedup_backups (run_id, organization_id, external_id)",
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS idx_message_external_id_dedup_audit_run ON message_external_id_dedup_audit (run_id, organization_id, external_id)",
      );
      await client.query(
        "ALTER TABLE message_external_id_dedup_backups ENABLE ROW LEVEL SECURITY",
      );
      await client.query(
        "ALTER TABLE message_external_id_dedup_audit ENABLE ROW LEVEL SECURITY",
      );
      await client.query(
        "DROP POLICY IF EXISTS mavo_tenant_isolation_message_external_id_dedup_backups ON message_external_id_dedup_backups",
      );
      await client.query(
        "DROP POLICY IF EXISTS mavo_tenant_isolation_message_external_id_dedup_audit ON message_external_id_dedup_audit",
      );
      await client.query(`
        CREATE POLICY mavo_tenant_isolation_message_external_id_dedup_backups
          ON message_external_id_dedup_backups
          USING (organization_id = mavo_current_organization_id())
          WITH CHECK (organization_id = mavo_current_organization_id())
      `);
      await client.query(`
        CREATE POLICY mavo_tenant_isolation_message_external_id_dedup_audit
          ON message_external_id_dedup_audit
          USING (organization_id = mavo_current_organization_id())
          WITH CHECK (organization_id = mavo_current_organization_id())
      `);

      await client.query(
        `INSERT INTO message_external_id_dedup_runs (
           id, canonical_order, duplicate_groups, duplicate_records, records_nullified
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          runId,
          "created_at ASC, id ASC",
          Number(lockedSummary.groups),
          Number(lockedSummary.records),
          Number(lockedSummary.records_to_nullify),
        ],
      );

      const backup = await client.query(
        `WITH ranked AS (
           SELECT
             m.*,
             ROW_NUMBER() OVER (
               PARTITION BY m.organization_id, m.external_id
               ORDER BY m.created_at ASC, m.id ASC
             ) AS duplicate_rank,
             COUNT(*) OVER (
               PARTITION BY m.organization_id, m.external_id
             ) AS duplicate_count
           FROM messages m
          WHERE m.external_id IS NOT NULL
         )
         INSERT INTO message_external_id_dedup_backups (
           run_id, organization_id, external_id, message_id, is_canonical, original_message
         )
         SELECT $1, organization_id, external_id, id, duplicate_rank = 1, to_jsonb(ranked)
           FROM ranked
          WHERE duplicate_count > 1`,
        [runId],
      );
      if (backup.rowCount !== Number(lockedSummary.records)) {
        throw new Error(
          `Backup incompleto: esperado ${lockedSummary.records}, gravado ${backup.rowCount}.`,
        );
      }

      const audit = await client.query(
        `WITH ranked AS (
           SELECT
             m.id,
             m.organization_id,
             m.external_id,
             ROW_NUMBER() OVER (
               PARTITION BY m.organization_id, m.external_id
               ORDER BY m.created_at ASC, m.id ASC
             ) AS duplicate_rank,
             FIRST_VALUE(m.id) OVER (
               PARTITION BY m.organization_id, m.external_id
               ORDER BY m.created_at ASC, m.id ASC
             ) AS canonical_message_id
           FROM messages m
          WHERE m.external_id IS NOT NULL
         ),
         to_nullify AS (
           SELECT id, organization_id, external_id, canonical_message_id
             FROM ranked
            WHERE duplicate_rank > 1
         ),
         changed AS (
           UPDATE messages m
              SET external_id = NULL
             FROM to_nullify d
            WHERE m.id = d.id
              AND m.organization_id = d.organization_id
              AND m.external_id = d.external_id
           RETURNING m.id, m.organization_id
         )
         INSERT INTO message_external_id_dedup_audit (
           run_id, organization_id, external_id, message_id, canonical_message_id,
           action, previous_external_id, new_external_id, selection_rule
         )
         SELECT
           $1, d.organization_id, d.external_id, d.id, d.canonical_message_id,
           'external_id_nullified', d.external_id, NULL,
           'created_at ASC, id ASC'
           FROM changed c
           JOIN to_nullify d
             ON d.id = c.id AND d.organization_id = c.organization_id`,
        [runId],
      );
      if (audit.rowCount !== Number(lockedSummary.records_to_nullify)) {
        throw new Error(
          `Auditoria/atualização incompleta: esperado ${lockedSummary.records_to_nullify}, gravado ${audit.rowCount}.`,
        );
      }

      const remaining = await readDuplicateSummary(client);
      if (Number(remaining.groups) !== 0) {
        throw new Error(
          `Ainda restaram ${remaining.groups} grupos duplicados após a atualização.`,
        );
      }

      await client.query(
        "UPDATE message_external_id_dedup_runs SET completed_at = now() WHERE id = $1",
        [runId],
      );
      await client.query("COMMIT");
      console.log(
        JSON.stringify(
          {
            status: "applied",
            runId,
            backedUpRecords: backup.rowCount,
            nullifiedExternalIds: audit.rowCount,
            remainingDuplicateGroups: 0,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    await releaseMigrationLock(client);
    client.release();
    await pool.end();
  }
});
