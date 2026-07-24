-- Mavo Talk: agregados enviados pelas views autorizadas do cliente.
-- Upsert autoritativo por organização/data e, quando aplicável, produto.
-- Rollback manual: remover business_query_audit, business_inventory_entries_daily,
-- business_product_sales_daily e business_sales_daily.
BEGIN;

CREATE TABLE IF NOT EXISTS business_sales_daily (
  organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  sale_date         DATE NOT NULL,
  gross_total       NUMERIC(19,4) NOT NULL DEFAULT 0,
  net_total         NUMERIC(19,4) NOT NULL DEFAULT 0,
  discount_total    NUMERIC(19,4) NOT NULL DEFAULT 0,
  cancelled_total   NUMERIC(19,4) NOT NULL DEFAULT 0,
  sales_count       INTEGER NOT NULL DEFAULT 0 CHECK (sales_count >= 0),
  items_quantity    NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (items_quantity >= 0),
  average_ticket    NUMERIC(19,4) NOT NULL DEFAULT 0,
  source_updated_at TIMESTAMPTZ NOT NULL,
  sync_batch_id     TEXT REFERENCES agent_sync_batches(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, sale_date)
);

CREATE TABLE IF NOT EXISTS business_product_sales_daily (
  organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  sale_date         DATE NOT NULL,
  product_id        TEXT NOT NULL CHECK (char_length(product_id) <= 200),
  sku               TEXT,
  product_name      TEXT NOT NULL CHECK (char_length(product_name) <= 500),
  quantity          NUMERIC(19,4) NOT NULL DEFAULT 0,
  gross_total       NUMERIC(19,4) NOT NULL DEFAULT 0,
  net_total         NUMERIC(19,4) NOT NULL DEFAULT 0,
  source_updated_at TIMESTAMPTZ NOT NULL,
  sync_batch_id     TEXT REFERENCES agent_sync_batches(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, sale_date, product_id)
);

CREATE TABLE IF NOT EXISTS business_inventory_entries_daily (
  organization_id   TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  entry_date        DATE NOT NULL,
  product_id        TEXT NOT NULL CHECK (char_length(product_id) <= 200),
  sku               TEXT,
  product_name      TEXT NOT NULL CHECK (char_length(product_name) <= 500),
  quantity_entered  NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (quantity_entered >= 0),
  total_cost        NUMERIC(19,4),
  source_updated_at TIMESTAMPTZ NOT NULL,
  sync_batch_id     TEXT REFERENCES agent_sync_batches(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, entry_date, product_id)
);

CREATE TABLE IF NOT EXISTS business_query_audit (
  id                     TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  access_user_id         TEXT,
  application_user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  phone_normalized       TEXT,
  conversation_reference TEXT,
  origin                 TEXT NOT NULL CHECK (origin IN ('whatsapp', 'ui', 'mcp', 'api')),
  query_type             TEXT NOT NULL,
  sanitized_input        TEXT,
  parameters_json        JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parameters_json) = 'object'),
  result_summary         JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result_summary) = 'object'),
  status                 TEXT NOT NULL CHECK (status IN ('success', 'empty', 'denied', 'failed')),
  error_code             TEXT,
  duration_ms            INTEGER NOT NULL CHECK (duration_ms >= 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_business_query_user_tenant
    FOREIGN KEY (access_user_id, organization_id)
    REFERENCES business_access_users(id, organization_id)
    ON DELETE RESTRICT
);

COMMIT;
