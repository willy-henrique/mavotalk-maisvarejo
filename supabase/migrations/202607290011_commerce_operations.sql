-- Mavo Talk: ofertas, perfil operacional, entregas e pedidos por organização.
-- Não remove dados existentes. Todos os registros usam organization_id como tenant_id.
-- Rollback manual: remover as policies e tabelas novas nesta ordem:
-- notification_outbox, order_status_history, orders, delivery_schedule,
-- delivery_settings, business_special_hours, business_locations,
-- promotion_media, promotions.
BEGIN;

DO $$ BEGIN
  CREATE TYPE promotion_status AS ENUM ('draft', 'scheduled', 'active', 'expired', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_delivery_status AS ENUM ('received', 'confirmed', 'preparing', 'ready', 'dispatched', 'cancelled', 'delivered');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE notification_outbox_status AS ENUM ('pending', 'processing', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 2 AND 180),
  description TEXT,
  status promotion_status NOT NULL DEFAULT 'draft',
  starts_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ,
  CHECK (expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_promotions_org_validity ON promotions (organization_id, status, starts_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_promotions_org_updated ON promotions (organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS promotion_media (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  promotion_id TEXT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  cloudinary_public_id TEXT,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  bytes INTEGER NOT NULL CHECK (bytes > 0 AND bytes <= 8388608),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promotion_media_org_promotion ON promotion_media (organization_id, promotion_id, position);

CREATE TABLE IF NOT EXISTS business_locations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL UNIQUE REFERENCES organizations(id),
  store_name TEXT,
  address_line TEXT,
  neighborhood TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  landmark TEXT,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  maps_url TEXT,
  phone TEXT,
  whatsapp TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

ALTER TABLE business_hours ADD COLUMN IF NOT EXISTS break_start_time TEXT;
ALTER TABLE business_hours ADD COLUMN IF NOT EXISTS break_end_time TEXT;
ALTER TABLE business_hours ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE business_hours DROP CONSTRAINT IF EXISTS business_hours_break_check;
ALTER TABLE business_hours ADD CONSTRAINT business_hours_break_check CHECK (
  (break_start_time IS NULL AND break_end_time IS NULL) OR
  (break_start_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' AND break_end_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' AND break_start_time < break_end_time)
);

CREATE TABLE IF NOT EXISTS business_special_hours (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  calendar_date DATE NOT NULL,
  start_time TEXT,
  end_time TEXT,
  break_start_time TEXT,
  break_end_time TEXT,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, calendar_date),
  CHECK (is_closed OR (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time))
);

CREATE TABLE IF NOT EXISTS delivery_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL UNIQUE REFERENCES organizations(id),
  is_active BOOLEAN NOT NULL DEFAULT false,
  min_minutes INTEGER NOT NULL DEFAULT 30 CHECK (min_minutes BETWEEN 1 AND 1440),
  max_minutes INTEGER NOT NULL DEFAULT 60 CHECK (max_minutes BETWEEN 1 AND 1440),
  default_minutes INTEGER CHECK (default_minutes IS NULL OR default_minutes BETWEEN 1 AND 1440),
  additional_margin_minutes INTEGER NOT NULL DEFAULT 0 CHECK (additional_margin_minutes BETWEEN 0 AND 720),
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  dispatch_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (min_minutes <= max_minutes),
  CHECK (default_minutes IS NULL OR (default_minutes >= min_minutes AND default_minutes <= max_minutes))
);

CREATE TABLE IF NOT EXISTS delivery_schedule (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, weekday),
  CHECK (start_time < end_time)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  contact_id TEXT REFERENCES contacts(id),
  conversation_id TEXT REFERENCES conversations(id),
  order_number TEXT NOT NULL,
  responsible_user_id TEXT REFERENCES users(id),
  delivery_status order_delivery_status NOT NULL DEFAULT 'received',
  ordered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  estimated_min_minutes INTEGER,
  estimated_max_minutes INTEGER,
  estimated_start_at TIMESTAMPTZ,
  estimated_end_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, order_number),
  CHECK ((estimated_min_minutes IS NULL AND estimated_max_minutes IS NULL) OR (estimated_min_minutes >= 0 AND estimated_max_minutes >= estimated_min_minutes)),
  CHECK ((estimated_start_at IS NULL AND estimated_end_at IS NULL) OR estimated_end_at >= estimated_start_at)
);
CREATE INDEX IF NOT EXISTS idx_orders_org_status_date ON orders (organization_id, delivery_status, ordered_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_org_contact ON orders (organization_id, contact_id, ordered_at DESC);

CREATE TABLE IF NOT EXISTS order_status_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  previous_status order_delivery_status,
  next_status order_delivery_status NOT NULL,
  changed_by TEXT REFERENCES users(id),
  origin TEXT NOT NULL DEFAULT 'panel',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_history_org_order ON order_status_history (organization_id, order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  destination TEXT NOT NULL,
  message_body TEXT NOT NULL,
  status notification_outbox_status NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  last_error_code TEXT,
  last_error_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  processing_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending ON notification_outbox (organization_id, status, created_at) WHERE status IN ('pending', 'failed');

-- Reaplica RLS nos objetos criados depois da migration de políticas base.
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'promotions', 'promotion_media', 'business_locations', 'business_special_hours',
    'delivery_settings', 'delivery_schedule', 'orders', 'order_status_history', 'notification_outbox'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS mavo_tenant_isolation_%I ON %I', table_name, table_name);
    EXECUTE format('CREATE POLICY mavo_tenant_isolation_%I ON %I USING (organization_id = mavo_current_organization_id()) WITH CHECK (organization_id = mavo_current_organization_id())', table_name, table_name);
  END LOOP;
END $$;

COMMIT;
