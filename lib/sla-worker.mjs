import pg from "pg";

const { Pool } = pg;

let pool;

function databaseUrl() {
  const value = process.env.DATABASE_URL_RUNTIME || process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL_MISSING");
  return value;
}

function getPool() {
  if (pool) return pool;
  const ssl = process.env.PG_SSL === "true" ||
    (process.env.PG_SSL !== "false" && process.env.NODE_ENV === "production")
    ? { rejectUnauthorized: false }
    : undefined;
  pool = new Pool({
    connectionString: databaseUrl(),
    ssl,
    max: 2,
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS) || 10_000,
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS) || 30_000,
    query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS) || 30_000,
    keepAlive: true,
  });
  return pool;
}

/**
 * Marca um SLA de primeira resposta vencido uma única vez.
 *
 * Jobs antigos são esperados quando uma fila é trocada. A cláusula de update
 * valida novamente prazo, conversa aberta e ausência de primeira resposta,
 * portanto esses jobs ficam inofensivos e não geram auditoria duplicada.
 */
export async function processFirstResponseSlaCheck({ organizationId, conversationId }) {
  if (!organizationId || !conversationId) {
    throw new Error("SLA_JOB_CONTEXT_MISSING");
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
    const result = await client.query(
      `UPDATE tickets AS ticket
          SET first_response_sla_breached_at = now(),
              updated_at = now()
         FROM conversations AS conversation
        WHERE ticket.organization_id = $1
          AND ticket.conversation_id = $2
          AND conversation.id = ticket.conversation_id
          AND conversation.organization_id = ticket.organization_id
          AND conversation.status <> 'encerrado'
          AND ticket.closed_at IS NULL
          AND ticket.first_response_at IS NULL
          AND ticket.first_response_due_at IS NOT NULL
          AND ticket.first_response_due_at <= now()
          AND ticket.first_response_sla_breached_at IS NULL
      RETURNING ticket.id, ticket.first_response_due_at`,
      [organizationId, conversationId],
    );

    const ticket = result.rows[0];
    if (ticket) {
      await client.query(
        `INSERT INTO audit_logs (
           id, organization_id, actor_user_id, action, entity_type, entity_id,
           metadata, created_at
         )
         VALUES (gen_random_uuid()::text, $1, NULL, 'sla_first_response_breached',
                 'ticket', $2, $3::jsonb, now())`,
        [
          organizationId,
          ticket.id,
          JSON.stringify({ conversationId, dueAt: ticket.first_response_due_at }),
        ],
      );
    }
    await client.query("COMMIT");
    return { breached: Boolean(ticket), ticketId: ticket?.id || null };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function closeSlaWorkerPool() {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}
