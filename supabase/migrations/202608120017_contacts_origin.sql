-- Marca a origem do contato para que a limpeza ao desconectar o WhatsApp remova
-- apenas o que veio da agenda importada.
--
-- Sem esta coluna nao haveria como distinguir um contato importado de um cliente
-- real, e a limpeza apagaria historico de atendimento.
BEGIN;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS origin TEXT NULL;

-- A limpeza filtra por origem dentro do tenant.
CREATE INDEX IF NOT EXISTS idx_contacts_org_origin
  ON contacts (organization_id, origin);

COMMIT;
