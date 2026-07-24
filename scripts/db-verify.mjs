import { createMigrationPool } from "./db-common.mjs";

const requiredTables = [
  "organizations",
  "users",
  "contacts",
  "conversations",
  "tickets",
  "messages",
  "business_access_users",
  "business_access_sessions",
  "agent_installations",
  "agent_sync_batches",
  "business_sales_daily",
  "business_product_sales_daily",
  "business_inventory_entries_daily",
  "business_query_audit",
];

const pool = createMigrationPool();
try {
  const tables = await pool.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [requiredTables],
  );
  const found = new Set(tables.rows.map((row) => String(row.table_name)));
  const missing = requiredTables.filter((table) => !found.has(table));

  const duplicateMessages = await pool.query(`
    SELECT COUNT(*)::int AS groups
      FROM (
        SELECT organization_id, external_id
          FROM messages
         WHERE external_id IS NOT NULL
         GROUP BY organization_id, external_id
        HAVING COUNT(*) > 1
      ) duplicates
  `);

  const rls = await pool.query(
    `SELECT relname, relrowsecurity
       FROM pg_class
      WHERE relkind = 'r'
        AND relname = ANY($1::text[])`,
    [requiredTables],
  );
  const rlsMissing = rls.rows
    .filter((row) => !row.relrowsecurity)
    .map((row) => String(row.relname));

  console.log(
    JSON.stringify(
      {
        status:
          missing.length === 0 &&
          rlsMissing.length === 0 &&
          duplicateMessages.rows[0]?.groups === 0
            ? "ok"
            : "attention",
        missingTables: missing,
        tablesWithoutRls: rlsMissing,
        duplicateExternalMessageGroups:
          duplicateMessages.rows[0]?.groups ?? 0,
      },
      null,
      2,
    ),
  );
  if (missing.length || rlsMissing.length || duplicateMessages.rows[0]?.groups) {
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
