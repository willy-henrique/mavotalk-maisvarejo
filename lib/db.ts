import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { logger } from "@/lib/logger";
import { sanitizedError } from "@/lib/observability";

declare global {
  var __mavoDatabasePool: Pool | undefined;
}

function databaseUrl(): string {
  const value = process.env.DATABASE_URL_RUNTIME || process.env.DATABASE_URL;
  if (!value) {
    throw new Error("DATABASE_URL_RUNTIME ou DATABASE_URL não configurada");
  }
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function shouldUseSsl(): boolean {
  if (process.env.PG_SSL === "false") return false;
  if (process.env.PG_SSL === "true") return true;
  return process.env.NODE_ENV === "production";
}

export function getDatabasePool(): Pool {
  if (global.__mavoDatabasePool) return global.__mavoDatabasePool;

  const pool = new Pool({
    connectionString: databaseUrl(),
    max: positiveInteger("PG_POOL_MAX", 10),
    connectionTimeoutMillis: positiveInteger("PG_CONNECTION_TIMEOUT_MS", 10_000),
    idleTimeoutMillis: positiveInteger("PG_IDLE_TIMEOUT_MS", 30_000),
    allowExitOnIdle: false,
    application_name: process.env.PG_APPLICATION_NAME || "mavo-talk-api",
    ssl: shouldUseSsl() ? { rejectUnauthorized: false } : undefined,
  });

  pool.on("error", (error) => {
    logger.error(
      { error: sanitizedError(error) },
      "Unexpected PostgreSQL pool error",
    );
  });

  global.__mavoDatabasePool = pool;
  return pool;
}

export async function queryDatabase<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  return getDatabasePool().query<T>(text, [...values]);
}

export async function withTenantTransaction<T>(
  organizationId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!organizationId.trim()) {
    throw new Error("Contexto de organização ausente");
  }

  const client = await getDatabasePool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [
      organizationId,
    ]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await queryDatabase("SELECT 1");
    return true;
  } catch (error) {
    logger.warn(
      { error: sanitizedError(error) },
      "Database health check failed",
    );
    return false;
  }
}

export async function closeDatabasePool(): Promise<void> {
  const pool = global.__mavoDatabasePool;
  if (!pool) return;
  global.__mavoDatabasePool = undefined;
  await pool.end();
}
