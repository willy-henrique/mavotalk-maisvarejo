import pg from "pg";

const { Pool } = pg;

let pool;

/**
 * Persistência da saída do atendente do painel.
 *
 * Vive fora do Next porque quem observa a desconexão é o socket, montado pelo
 * `server.cjs`, que não participa do grafo de módulos do Next e portanto não
 * alcança `lib/db.ts`. É o mesmo arranjo de `lib/sla-worker.mjs`: pool próprio,
 * criado sob demanda.
 *
 * `max: 1` de propósito. A escrita acontece uma vez por atendente que fecha o
 * painel — o volume não justifica segurar conexões de um Postgres compartilhado
 * com o worker e com a aplicação.
 */
function databaseUrl() {
  const value = process.env.DATABASE_URL_RUNTIME || process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL_MISSING");
  return value;
}

function getPool() {
  if (pool) return pool;
  const ssl =
    process.env.PG_SSL === "true" ||
    (process.env.PG_SSL !== "false" && process.env.NODE_ENV === "production")
      ? { rejectUnauthorized: false }
      : undefined;
  pool = new Pool({
    connectionString: databaseUrl(),
    ssl,
    max: 1,
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS) || 10_000,
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS) || 30_000,
    query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS) || 30_000,
    keepAlive: true,
  });
  return pool;
}

/**
 * Grava quando o atendente esteve no painel pela última vez.
 *
 * `GREATEST` nunca deixa o valor recuar: reconexões fora de ordem, comuns em
 * rede instável, chegariam com um instante mais antigo e apagariam uma presença
 * mais recente.
 */
export async function saveLastSeen(organizationId, userId, seenAt) {
  if (!organizationId || !userId) return;
  const timestamp = new Date(seenAt || Date.now()).toISOString();
  await getPool().query(
    `UPDATE users
        SET last_seen_at = GREATEST($3::timestamptz, COALESCE(last_seen_at, $3::timestamptz))
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, userId, timestamp],
  );
}

export async function closePresenceStore() {
  if (!pool) return;
  const closing = pool;
  pool = undefined;
  await closing.end().catch(() => undefined);
}
