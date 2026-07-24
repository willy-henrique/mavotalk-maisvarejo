import {
  createMigrationPool,
  ensureMigrationsTable,
  listMigrationFiles,
  readMigration,
} from "./db-common.mjs";

const pool = createMigrationPool();
try {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const result = await client.query(
      "SELECT version, checksum, applied_at FROM mavo_schema_migrations ORDER BY version",
    );
    const applied = new Map(result.rows.map((row) => [String(row.version), row]));

    for (const fileName of await listMigrationFiles()) {
      const expected = await readMigration(fileName);
      const row = applied.get(fileName);
      const status = !row
        ? "PENDING"
        : row.checksum === expected.checksum
          ? "APPLIED"
          : "CHANGED";
      console.log(`${status.padEnd(8)} ${fileName}`);
    }
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
