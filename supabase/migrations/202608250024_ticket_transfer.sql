-- Transferência de chamado entre técnicos, e devolução para a fila.
--
-- O histórico completo fica em audit_logs, que já aceita ação livre. Estas
-- colunas guardam só a transferência mais recente, que é o que a tela precisa
-- mostrar para quem recebeu o chamado: quem passou e por quê. Buscar isso no
-- audit a cada abertura de conversa custaria uma consulta a mais no caminho
-- mais quente do painel.
--
-- Nada aqui toca first_response_at, de propósito: transferir não é responder,
-- e sobrescrever aquele instante falsificaria o SLA de primeira resposta que
-- alimenta os cartões da Visão da operação.
--
-- Aditiva: as três colunas podem ser removidas com ALTER TABLE ... DROP COLUMN.
BEGIN;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS transferred_from TEXT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS transfer_note TEXT NULL;

-- Quem recebeu chamado transferido e ainda não fechou: a consulta que a tela do
-- técnico faz ao abrir a conversa.
CREATE INDEX IF NOT EXISTS idx_tickets_organization_transferred
  ON tickets (organization_id, transferred_at DESC)
  WHERE transferred_at IS NOT NULL;

COMMIT;
