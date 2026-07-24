import { createMigrationPool } from "./db-common.mjs";
import { bootstrapDefaultOrganization } from "./db-bootstrap-common.mjs";

const pool = createMigrationPool();
const client = await pool.connect();
try {
  const organizationId = await bootstrapDefaultOrganization(client);
  console.log(
    JSON.stringify({
      status: "ok",
      defaultOrganization: organizationId,
    }),
  );
} finally {
  client.release();
  await pool.end();
}
