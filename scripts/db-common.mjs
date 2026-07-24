import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

export const migrationsDirectory = path.resolve(
  process.cwd(),
  "supabase",
  "migrations",
);

export function migrationDatabaseUrl() {
  const value =
    process.env.DATABASE_URL_MIGRATIONS ||
    process.env.DATABASE_URL_RUNTIME ||
    process.env.DATABASE_URL;
  if (!value) {
    throw new Error(
      "Configure DATABASE_URL_MIGRATIONS (ou DATABASE_URL em desenvolvimento)",
    );
  }
  return value;
}

export function createMigrationPool() {
  const ssl =
    process.env.PG_SSL === "true" ||
    (process.env.NODE_ENV === "production" && process.env.PG_SSL !== "false");
  return new Pool({
    connectionString: migrationDatabaseUrl(),
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    application_name: "mavo-talk-migrations",
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
  });
}

export async function listMigrationFiles() {
  return (await readdir(migrationsDirectory))
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort();
}

export async function readMigration(fileName) {
  const sql = await readFile(path.join(migrationsDirectory, fileName), "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  return { sql, checksum };
}

export async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS mavo_schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}
