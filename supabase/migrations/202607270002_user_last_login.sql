ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_users_organization_last_login
  ON users (organization_id, last_login_at DESC);
