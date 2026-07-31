import {
  acquireMigrationLock,
  applyMigrationSessionGuards,
  createMigrationPool,
  ensureMigrationsTable,
  isCompatibleMigrationChecksum,
  listMigrationFiles,
  readMigration,
  releaseMigrationLock,
  runDeployStep,
} from "./db-common.mjs";
import { bootstrapDefaultOrganization } from "./db-bootstrap-common.mjs";

await runDeployStep("db:migrate", async () => {
  const pool = createMigrationPool();
  const client = await pool.connect();

  try {
    await applyMigrationSessionGuards(client);
    await acquireMigrationLock(client);
    await ensureMigrationsTable(client);

    const appliedResult = await client.query(
      "SELECT version, checksum FROM mavo_schema_migrations ORDER BY version",
    );
    const applied = new Map(
      appliedResult.rows.map((row) => [
        String(row.version),
        String(row.checksum),
      ]),
    );

    for (const fileName of await listMigrationFiles()) {
      const { sql, checksum } = await readMigration(fileName);
      const previousChecksum = applied.get(fileName);
      if (previousChecksum) {
        if (previousChecksum !== checksum && !isCompatibleMigrationChecksum(fileName, previousChecksum)) {
          throw new Error(
            `Migration já aplicada foi alterada: ${fileName}. Crie uma nova migration.`,
          );
        }
        console.log(`SKIP ${fileName}`);
        continue;
      }

      if (fileName === "202607230005_indexes.sql") {
        const duplicateMessages = await client.query(`
          SELECT organization_id, external_id, COUNT(*)::int AS occurrences
            FROM messages
           WHERE external_id IS NOT NULL
           GROUP BY organization_id, external_id
          HAVING COUNT(*) > 1
           LIMIT 20
        `);
        if (duplicateMessages.rowCount) {
          throw new Error(
            "A migration de idempotência encontrou external_id duplicado em messages. " +
              "Nenhum dado foi alterado. Revise os grupos com npm run db:verify e " +
              "defina uma estratégia explícita de consolidação antes de reaplicar.",
          );
        }
      }

      console.log(`APPLY ${fileName}`);
      await client.query(sql);
      await client.query(
        "INSERT INTO mavo_schema_migrations (version, checksum) VALUES ($1, $2)",
        [fileName, checksum],
      );
      console.log(`OK ${fileName}`);
    }

    if (process.env.NODE_ENV === "production") {
      const organizationId = await bootstrapDefaultOrganization(client);
      console.log(`BOOTSTRAP organization ${organizationId}`);
    }
  } finally {
    await releaseMigrationLock(client);
    client.release();
    await pool.end();
  }
});
