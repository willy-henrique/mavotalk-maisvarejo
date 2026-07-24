-- Sessão Baileys persistente e cifrada para sobreviver a restart/deploy.
-- O backend cifra cada valor com AES-256-GCM antes de gravar; o banco nunca
-- recebe credenciais ou chaves Signal em texto puro.
-- Rollback manual: DROP TABLE whatsapp_auth_state;
BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp_auth_state (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_name    TEXT NOT NULL
                  CHECK (char_length(trim(session_name)) BETWEEN 1 AND 120),
  key_type        TEXT NOT NULL
                  CHECK (char_length(trim(key_type)) BETWEEN 1 AND 80),
  key_id          TEXT NOT NULL
                  CHECK (char_length(trim(key_id)) BETWEEN 1 AND 500),
  ciphertext      TEXT NOT NULL,
  iv              TEXT NOT NULL,
  auth_tag        TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, session_name, key_type, key_id)
);

ALTER TABLE whatsapp_auth_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mavo_tenant_isolation_whatsapp_auth_state
  ON whatsapp_auth_state;
CREATE POLICY mavo_tenant_isolation_whatsapp_auth_state
  ON whatsapp_auth_state
  USING (organization_id = mavo_current_organization_id())
  WITH CHECK (organization_id = mavo_current_organization_id());

COMMIT;
