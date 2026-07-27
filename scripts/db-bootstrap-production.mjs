import {
  applyMigrationSessionGuards,
  createMigrationPool,
  runDeployStep,
} from "./db-common.mjs";
import { bootstrapDefaultOrganization } from "./db-bootstrap-common.mjs";

await runDeployStep("db:bootstrap:production", async () => {
  const pool = createMigrationPool();
  const client = await pool.connect();
  try {
    await applyMigrationSessionGuards(client);
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
});
