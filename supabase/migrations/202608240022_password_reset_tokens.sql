-- Recuperação de senha do Mavo Gerenciamento.
-- Guarda somente SHA-256 do segredo enviado ao usuário. A tabela é aditiva e
-- pode ser removida com DROP TABLE password_reset_tokens se ainda não houver uso.
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS recovery_phone TEXT
  CHECK (recovery_phone IS NULL OR recovery_phone ~ '^[0-9]{10,15}$');

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_id_organization
  ON users (id, organization_id);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  token_hash      TEXT NOT NULL UNIQUE
                  CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id         TEXT NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_password_reset_user_tenant
    FOREIGN KEY (user_id, organization_id)
    REFERENCES users(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT ck_password_reset_expiry CHECK (expires_at > created_at),
  CONSTRAINT ck_password_reset_usage CHECK (used_at IS NULL OR used_at >= created_at)
);

CREATE INDEX IF NOT EXISTS idx_password_reset_active_user
  ON password_reset_tokens (organization_id, user_id, expires_at DESC)
  WHERE used_at IS NULL;

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mavo_tenant_isolation_password_reset_tokens
  ON password_reset_tokens;
CREATE POLICY mavo_tenant_isolation_password_reset_tokens
  ON password_reset_tokens
  USING (organization_id = mavo_current_organization_id())
  WITH CHECK (organization_id = mavo_current_organization_id());

COMMIT;
