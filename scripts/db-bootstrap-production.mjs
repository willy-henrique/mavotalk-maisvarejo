import { createMigrationPool } from "./db-common.mjs";

const organizationId = String(
  process.env.DEFAULT_ORG_ID || "org_willtalk_default",
).trim();
const organizationName =
  String(process.env.SUPERMARKET_NAME || "").trim() || "Supermercado Mavo";

if (!organizationId || organizationId.length > 120) {
  throw new Error("DEFAULT_ORG_ID deve conter entre 1 e 120 caracteres");
}
if (organizationName.length > 160) {
  throw new Error("SUPERMARKET_NAME deve conter no máximo 160 caracteres");
}

const pool = createMigrationPool();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.organization_id', $1, true)", [
    organizationId,
  ]);
  await client.query(
    `INSERT INTO organizations (id, name)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [organizationId, organizationName],
  );
  await client.query("COMMIT");
  console.log(
    JSON.stringify({
      status: "ok",
      defaultOrganization: organizationId,
    }),
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
