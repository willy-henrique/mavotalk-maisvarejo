-- Nomes da agenda do WhatsApp da loja, usados para identificar clientes recorrentes.
-- O painel nomeia o contato pelo pushName (nome que o proprio cliente escolheu no
-- perfil); esta tabela guarda o nome que a loja salvou, que e o util no atendimento.
--
-- Tabela de consulta, nao alimenta a tela de Contatos: um contato da plataforma
-- continua sendo criado apenas quando a pessoa realmente conversa.
-- Rollback manual: DROP TABLE whatsapp_directory;
BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp_directory (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone_number    TEXT NOT NULL
                  CHECK (char_length(trim(phone_number)) BETWEEN 5 AND 30),
  display_name    TEXT NOT NULL
                  CHECK (char_length(trim(display_name)) BETWEEN 1 AND 200),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, phone_number)
);

ALTER TABLE whatsapp_directory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mavo_tenant_isolation_whatsapp_directory
  ON whatsapp_directory;
CREATE POLICY mavo_tenant_isolation_whatsapp_directory
  ON whatsapp_directory
  USING (organization_id = mavo_current_organization_id())
  WITH CHECK (organization_id = mavo_current_organization_id());

COMMIT;
