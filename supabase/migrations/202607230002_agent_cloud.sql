-- Mavo Talk: instalações, credenciais, replay protection e lotes do agente.
-- Segredos HMAC são armazenados cifrados; somente a impressão digital é logável.
-- Rollback manual: remover agent_audit_events, agent_nonces,
-- agent_sync_batches, agent_credentials e agent_installations.
BEGIN;

CREATE TABLE IF NOT EXISTS agent_installations (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name               TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 200),
  installation_key   TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'provisioned'
                     CHECK (status IN ('provisioned', 'online', 'offline', 'revoked', 'error')),
  agent_version      TEXT,
  schema_version     TEXT,
  last_heartbeat_at  TIMESTAMPTZ,
  last_sync_at       TIMESTAMPTZ,
  last_ip            INET,
  last_error_code    TEXT,
  revoked_at         TIMESTAMPTZ,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS agent_credentials (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  agent_id             TEXT NOT NULL REFERENCES agent_installations(id) ON DELETE CASCADE,
  secret_ciphertext    TEXT NOT NULL,
  secret_iv            TEXT NOT NULL,
  secret_auth_tag      TEXT NOT NULL,
  secret_fingerprint   TEXT NOT NULL,
  key_version          INTEGER NOT NULL CHECK (key_version > 0),
  expires_at           TIMESTAMPTZ,
  revoked_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, key_version)
);

CREATE TABLE IF NOT EXISTS agent_sync_batches (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  agent_id             TEXT NOT NULL,
  batch_id             UUID NOT NULL,
  data_type            TEXT NOT NULL CHECK (
    data_type IN ('sales_daily', 'product_sales_daily', 'inventory_entries_daily')
  ),
  payload_version      TEXT NOT NULL,
  agent_version        TEXT,
  source_timezone      TEXT NOT NULL,
  range_from           DATE NOT NULL,
  range_to             DATE NOT NULL,
  source_generated_at  TIMESTAMPTZ NOT NULL,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at         TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'received'
                       CHECK (status IN ('received', 'processing', 'processed', 'rejected', 'failed')),
  checksum             TEXT NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  item_count           INTEGER NOT NULL CHECK (item_count >= 0),
  processed_count      INTEGER NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  rejected_count       INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  error_summary        TEXT,
  CONSTRAINT fk_agent_batch_tenant
    FOREIGN KEY (agent_id, organization_id)
    REFERENCES agent_installations(id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT uq_agent_batch UNIQUE (agent_id, batch_id),
  CONSTRAINT ck_agent_batch_range CHECK (range_to >= range_from)
);

CREATE TABLE IF NOT EXISTS agent_nonces (
  agent_id     TEXT NOT NULL REFERENCES agent_installations(id) ON DELETE CASCADE,
  nonce        TEXT NOT NULL CHECK (char_length(nonce) BETWEEN 16 AND 200),
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, nonce)
);

CREATE TABLE IF NOT EXISTS agent_audit_events (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  agent_id           TEXT,
  batch_id           UUID,
  request_id         TEXT,
  event_type         TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('success', 'rejected', 'failed')),
  error_code         TEXT,
  duration_ms        INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  source_ip          INET,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_agent_audit_tenant
    FOREIGN KEY (agent_id, organization_id)
    REFERENCES agent_installations(id, organization_id)
    ON DELETE RESTRICT
);

COMMIT;
