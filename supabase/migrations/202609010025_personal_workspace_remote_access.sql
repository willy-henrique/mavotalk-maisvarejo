-- Espaço pessoal e cofre de acessos remotos.
-- O espaço pessoal é privado por usuário; o cofre pertence à organização e
-- nunca armazena a senha em texto puro.
BEGIN;

CREATE TABLE IF NOT EXISTS personal_workspace_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('note', 'task', 'link')),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  url TEXT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  due_at TIMESTAMPTZ NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_personal_workspace_owner_updated
  ON personal_workspace_items (organization_id, owner_user_id, is_pinned DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS remote_accesses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  provider TEXT NOT NULL CHECK (provider IN ('anydesk', 'teamviewer', 'other')),
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  username TEXT NULL,
  location TEXT NULL,
  responsible_name TEXT NULL,
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  secret_ciphertext TEXT NULL,
  secret_iv TEXT NULL,
  secret_auth_tag TEXT NULL,
  secret_key_version INTEGER NULL,
  created_by TEXT NULL REFERENCES users(id),
  updated_by TEXT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT remote_access_secret_complete CHECK (
    (secret_ciphertext IS NULL AND secret_iv IS NULL AND secret_auth_tag IS NULL AND secret_key_version IS NULL)
    OR
    (secret_ciphertext IS NOT NULL AND secret_iv IS NOT NULL AND secret_auth_tag IS NOT NULL AND secret_key_version IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_remote_accesses_org_active_label
  ON remote_accesses (organization_id, is_active, label);

CREATE TABLE IF NOT EXISTS remote_access_audit (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  remote_access_id TEXT NOT NULL REFERENCES remote_accesses(id) ON DELETE CASCADE,
  user_id TEXT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_remote_access_audit_asset_created
  ON remote_access_audit (organization_id, remote_access_id, created_at DESC);

ALTER TABLE personal_workspace_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE remote_accesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE remote_access_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mavo_tenant_isolation_personal_workspace_items ON personal_workspace_items;
CREATE POLICY mavo_tenant_isolation_personal_workspace_items ON personal_workspace_items
  USING (organization_id = mavo_current_organization_id())
  WITH CHECK (organization_id = mavo_current_organization_id());

DROP POLICY IF EXISTS mavo_tenant_isolation_remote_accesses ON remote_accesses;
CREATE POLICY mavo_tenant_isolation_remote_accesses ON remote_accesses
  USING (organization_id = mavo_current_organization_id())
  WITH CHECK (organization_id = mavo_current_organization_id());

DROP POLICY IF EXISTS mavo_tenant_isolation_remote_access_audit ON remote_access_audit;
CREATE POLICY mavo_tenant_isolation_remote_access_audit ON remote_access_audit
  USING (organization_id = mavo_current_organization_id())
  WITH CHECK (organization_id = mavo_current_organization_id());

COMMIT;
