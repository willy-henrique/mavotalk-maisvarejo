-- Mavo Talk: índices operacionais e constraints de idempotência.
-- Rollback: DROP INDEX CONCURRENTLY/normal para os índices abaixo, após análise.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_business_access_users_org_active
  ON business_access_users (organization_id, is_active, phone_normalized);
CREATE INDEX IF NOT EXISTS idx_business_access_users_locked
  ON business_access_users (organization_id, locked_until)
  WHERE locked_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_business_sessions_lookup
  ON business_access_sessions (organization_id, phone_normalized, expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_business_sessions_expiry
  ON business_access_sessions (expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_business_access_audit_org_created
  ON business_access_audit (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_whatsapp_events_created
  ON business_whatsapp_events (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_installations_org_status
  ON agent_installations (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_installations_heartbeat
  ON agent_installations (last_heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_credentials_active
  ON agent_credentials (agent_id, key_version DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_batches_org_received
  ON agent_sync_batches (organization_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_batches_status
  ON agent_sync_batches (agent_id, status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_nonces_expiry
  ON agent_nonces (expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_audit_org_created
  ON agent_audit_events (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_daily_org_date
  ON business_sales_daily (organization_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_product_sales_org_date
  ON business_product_sales_daily (organization_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_product_sales_org_product_date
  ON business_product_sales_daily (organization_id, product_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_org_date
  ON business_inventory_entries_daily (organization_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_org_product_date
  ON business_inventory_entries_daily (organization_id, product_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_business_query_audit_org_created
  ON business_query_audit (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_query_audit_user_created
  ON business_query_audit (organization_id, access_user_id, created_at DESC);

-- A deduplicação por external_id passa a ser garantida pelo banco, não apenas
-- por uma leitura anterior sujeita a corrida.
DROP INDEX IF EXISTS idx_messages_external_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_org_external_id
  ON messages (organization_id, external_id)
  WHERE external_id IS NOT NULL;

COMMIT;
