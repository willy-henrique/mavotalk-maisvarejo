-- Registra o primeiro vencimento de SLA de resposta de forma idempotente.
-- Não substitui first_response_at: o atendimento humano continua sendo a fonte
-- de verdade da primeira resposta efetiva.
BEGIN;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS first_response_sla_breached_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tickets_first_response_sla_pending
  ON tickets (organization_id, first_response_due_at)
  WHERE first_response_at IS NULL
    AND closed_at IS NULL
    AND first_response_sla_breached_at IS NULL;

COMMIT;
