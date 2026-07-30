import {
  applyMigrationSessionGuards,
  createMigrationPool,
  runDeployStep,
} from "./db-common.mjs";

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
  "whatsapp_auth_state",
  "promotions",
  "promotion_media",
  "business_locations",
  "delivery_settings",
  "delivery_schedule",
  "orders",
  "order_status_history",
  "notification_outbox",
];

await runDeployStep("db:verify", async () => {
  const pool = createMigrationPool();
  const organizationId = String(
    process.env.DEFAULT_ORG_ID || "org_willtalk_default",
  ).trim();
  const client = await pool.connect();
  try {
    await applyMigrationSessionGuards(client);
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [
      organizationId,
    ]);
    const tables = await client.query(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [requiredTables],
    );
    const found = new Set(tables.rows.map((row) => String(row.table_name)));
    const missing = requiredTables.filter((table) => !found.has(table));

    const duplicateMessages = await client.query(`
      SELECT COUNT(*)::int AS groups
        FROM (
          SELECT organization_id, external_id
            FROM messages
           WHERE external_id IS NOT NULL
           GROUP BY organization_id, external_id
          HAVING COUNT(*) > 1
        ) duplicates
    `);

    const rls = await client.query(
      `SELECT relname, relrowsecurity
         FROM pg_class
        WHERE relkind = 'r'
          AND relname = ANY($1::text[])`,
      [requiredTables],
    );
    const rlsMissing = rls.rows
      .filter((row) => !row.relrowsecurity)
      .map((row) => String(row.relname));
    const organization = await client.query(
      "SELECT id FROM organizations WHERE id = $1",
      [organizationId],
    );
    const defaultOrganizationExists = organization.rowCount === 1;

    console.log(
      JSON.stringify(
        {
          status:
            missing.length === 0 &&
            rlsMissing.length === 0 &&
            duplicateMessages.rows[0]?.groups === 0 &&
            defaultOrganizationExists
              ? "ok"
              : "attention",
          missingTables: missing,
          tablesWithoutRls: rlsMissing,
          duplicateExternalMessageGroups:
            duplicateMessages.rows[0]?.groups ?? 0,
          defaultOrganizationExists,
        },
        null,
        2,
      ),
    );
    if (
      missing.length ||
      rlsMissing.length ||
      duplicateMessages.rows[0]?.groups ||
      !defaultOrganizationExists
    ) {
      process.exitCode = 1;
    }
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
});
