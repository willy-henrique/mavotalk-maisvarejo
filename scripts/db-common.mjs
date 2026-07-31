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

export const MIGRATION_LOCK_KEY = "mavo-talk-migrations";

// A migration 012 foi ajustada antes de alcançar todos os ambientes para
// tolerar uma constraint criada previamente. A alteração é idempotente e não
// muda o schema final, então bancos que aplicaram a revisão original podem
// continuar reconhecendo-a como aplicada.
const COMPATIBLE_MIGRATION_CHECKSUMS = new Map([
  [
    "202607310012_queue_automations.sql",
    new Set(["40b5df7e44b8178d072384913c1286e5eaf54043a44c1cf25481d68aa56071cb"]),
  ],
  [
    "202607310013_queue_published_content.sql",
    new Set(["ebfcf36cb7ef7f67cfa188540c0ff2f21fccfb50f53d9070669a8812b4af3adf"]),
  ],
]);

export function isCompatibleMigrationChecksum(fileName, checksum) {
  return COMPATIBLE_MIGRATION_CHECKSUMS.get(fileName)?.has(checksum) ?? false;
}

function positiveMilliseconds(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Todo passo de banco do build precisa de teto: sem isso uma conexão pendurada
 * deixa o deploy do Render em "Building" até o limite da plataforma (~2h) em
 * vez de falhar com uma mensagem acionável.
 */
export function migrationTimeouts() {
  return {
    connectMs: positiveMilliseconds("DB_CONNECT_TIMEOUT_MS", 15_000),
    statementMs: positiveMilliseconds("DB_STATEMENT_TIMEOUT_MS", 300_000),
    lockMs: positiveMilliseconds("DB_LOCK_TIMEOUT_MS", 15_000),
    idleTransactionMs: positiveMilliseconds("DB_IDLE_TX_TIMEOUT_MS", 60_000),
    stepDeadlineMs: positiveMilliseconds("DB_STEP_DEADLINE_MS", 600_000),
    lockAttempts: positiveMilliseconds("DB_LOCK_ATTEMPTS", 10),
    lockWaitMs: positiveMilliseconds("DB_LOCK_WAIT_MS", 3_000),
  };
}

export function createMigrationPool() {
  const ssl =
    process.env.PG_SSL === "true" ||
    (process.env.NODE_ENV === "production" && process.env.PG_SSL !== "false");
  const timeouts = migrationTimeouts();
  return new Pool({
    connectionString: migrationDatabaseUrl(),
    max: 1,
    connectionTimeoutMillis: timeouts.connectMs,
    idleTimeoutMillis: 10_000,
    // query_timeout é client-side: aborta mesmo quando o servidor nunca responde.
    query_timeout: timeouts.statementMs,
    statement_timeout: timeouts.statementMs,
    // Sem keepalive uma sessão órfã do Supabase só é coletada pelo keepalive do
    // kernel (~2h), e o lock de migration que ela segura trava os builds seguintes.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    application_name: "mavo-talk-migrations",
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
  });
}

export async function applyMigrationSessionGuards(client, overrides = {}) {
  const { statementMs, lockMs, idleTransactionMs } = {
    ...migrationTimeouts(),
    ...overrides,
  };
  await client.query(`SET lock_timeout = ${Number(lockMs)}`);
  await client.query(`SET statement_timeout = ${Number(statementMs)}`);
  await client.query(
    `SET idle_in_transaction_session_timeout = ${Number(idleTransactionMs)}`,
  );
}

/**
 * `pg_advisory_lock` espera para sempre. Um build anterior morto pelo Render
 * deixa a sessão viva no servidor por horas, então a versão bloqueante
 * transformava cada deploy seguinte em um "Building" infinito.
 */
export async function acquireMigrationLock(client, options = {}) {
  const defaults = migrationTimeouts();
  const attempts = options.attempts ?? defaults.lockAttempts;
  const waitMs = options.waitMs ?? defaults.lockWaitMs;
  const sleep =
    options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [MIGRATION_LOCK_KEY],
    );
    if (result?.rows?.[0]?.acquired === true) return;
    if (attempt < attempts) await sleep(waitMs);
  }

  throw new Error(
    `MIGRATION_LOCK_BUSY: o lock de migration seguiu ocupado por ${Math.round(
      (attempts * waitMs) / 1000,
    )}s. Provavelmente há uma sessão órfã de um build cancelado. Verifique com ` +
      "SELECT pid, state, query FROM pg_stat_activity WHERE application_name = 'mavo-talk-migrations' " +
      "e encerre-a com pg_terminate_backend(pid).",
  );
}

export async function releaseMigrationLock(client) {
  await client
    .query("SELECT pg_advisory_unlock(hashtext($1))", [MIGRATION_LOCK_KEY])
    .catch(() => undefined);
}

export async function runWithDeadline(label, operation, options = {}) {
  const deadlineMs = options.deadlineMs ?? migrationTimeouts().stepDeadlineMs;
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `DEADLINE_EXCEEDED: a etapa "${label}" passou de ${Math.round(
                deadlineMs / 1000,
              )}s e foi abortada para não pendurar o deploy.`,
            ),
          );
        }, deadlineMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Encerra o processo mesmo com sockets pendurados: um `await` cancelado não
 * libera o event loop, e sair com código != 0 é o que faz o Render marcar o
 * build como falho em minutos em vez de horas.
 */
export async function runDeployStep(label, operation) {
  try {
    await runWithDeadline(label, operation);
  } catch (error) {
    console.error(`[${label}] ${error?.message || error}`);
    process.exit(1);
  }
  // Preserva um process.exitCode definido pela etapa (db:verify sinaliza 1).
  process.exit(process.exitCode ?? 0);
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

/**
 * Cada migration abre a própria transação, então aplicar o arquivo e registrar
 * a versão eram duas transações distintas: um build morto entre as duas deixa
 * o schema à frente de mavo_schema_migrations e toda tentativa seguinte quebra
 * em "already exists". Removendo o BEGIN/COMMIT do arquivo o runner grava o
 * registro dentro da mesma transação do DDL — ou nada acontece.
 */
export function migrationBody(sql) {
  const lines = sql.split(/\r?\n/);
  const isBegin = (line) => /^begin\s*;$/i.test(line.trim());
  const isCommit = (line) => /^commit\s*;$/i.test(line.trim());
  const begin = lines.findIndex(isBegin);
  const commit = lines.reduce(
    (last, line, index) => (isCommit(line) ? index : last),
    -1,
  );

  // Algumas migrations antigas não abrem transação própria: o runner já as
  // envolve, então o arquivo segue inteiro.
  if (begin === -1 || commit <= begin) return sql;

  return [
    ...lines.slice(0, begin),
    ...lines.slice(begin + 1, commit),
    ...lines.slice(commit + 1),
  ].join("\n");
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
