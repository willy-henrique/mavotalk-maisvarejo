-- Mavo Talk: segunda barreira de isolamento.
-- O backend deve executar operações tenant-aware com app.organization_id.
-- Conexões de manutenção/service role continuam fora destas políticas.
-- Rollback: remover as policies mavo_tenant_isolation_* e a função abaixo.
BEGIN;

CREATE OR REPLACE FUNCTION mavo_current_organization_id()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')
$$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'queues', 'contacts', 'conversations', 'tickets', 'messages',
    'quick_replies', 'audit_logs', 'business_hours', 'channels',
    'business_access_users', 'business_access_sessions', 'business_access_audit',
    'business_whatsapp_events',
    'agent_installations', 'agent_sync_batches', 'agent_audit_events',
    'business_sales_daily', 'business_product_sales_daily',
    'business_inventory_entries_daily', 'business_query_audit'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS mavo_tenant_isolation_%I ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY mavo_tenant_isolation_%I ON %I USING (organization_id = mavo_current_organization_id()) WITH CHECK (organization_id = mavo_current_organization_id())',
      table_name,
      table_name
    );
  END LOOP;
END
$$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mavo_tenant_isolation_organizations ON organizations;
CREATE POLICY mavo_tenant_isolation_organizations
  ON organizations
  USING (id = mavo_current_organization_id())
  WITH CHECK (id = mavo_current_organization_id());

-- Credenciais e nonces não carregam organization_id diretamente. O vínculo é
-- sempre validado através da instalação autenticada.
ALTER TABLE agent_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mavo_agent_credentials_tenant ON agent_credentials;
CREATE POLICY mavo_agent_credentials_tenant
  ON agent_credentials
  USING (
    EXISTS (
      SELECT 1
      FROM agent_installations ai
      WHERE ai.id = agent_credentials.agent_id
        AND ai.organization_id = mavo_current_organization_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM agent_installations ai
      WHERE ai.id = agent_credentials.agent_id
        AND ai.organization_id = mavo_current_organization_id()
    )
  );

ALTER TABLE agent_nonces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mavo_agent_nonces_tenant ON agent_nonces;
CREATE POLICY mavo_agent_nonces_tenant
  ON agent_nonces
  USING (
    EXISTS (
      SELECT 1
      FROM agent_installations ai
      WHERE ai.id = agent_nonces.agent_id
        AND ai.organization_id = mavo_current_organization_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM agent_installations ai
      WHERE ai.id = agent_nonces.agent_id
        AND ai.organization_id = mavo_current_organization_id()
    )
  );

COMMIT;
