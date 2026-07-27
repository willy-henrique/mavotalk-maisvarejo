-- Mantém a página de contatos responsiva quando um tenant acumula histórico.
-- A consulta busca somente a última conversa de cada contato já filtrado.
CREATE INDEX IF NOT EXISTS idx_conversations_org_contact_updated
  ON conversations (organization_id, contact_id, updated_at DESC, id DESC);
