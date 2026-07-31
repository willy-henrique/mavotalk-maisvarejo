-- Configurações publicáveis por fila. Mantém os dados legados da organização
-- enquanto as filas Ofertas e Horários passam a consumir somente a versão
-- publicada.
BEGIN;

ALTER TABLE queues ADD COLUMN IF NOT EXISTS queue_type TEXT NOT NULL DEFAULT 'custom';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'queues_queue_type_check'
       AND conrelid = 'queues'::regclass
  ) THEN
    ALTER TABLE queues ADD CONSTRAINT queues_queue_type_check
      CHECK (queue_type IN ('custom', 'offers_promotions', 'business_hours_location'));
  END IF;
END $$;
UPDATE queues SET queue_type = 'offers_promotions' WHERE menu_option = 1 AND queue_type = 'custom';
UPDATE queues SET queue_type = 'business_hours_location' WHERE menu_option = 2 AND queue_type = 'custom';

CREATE TABLE IF NOT EXISTS queue_configurations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  queue_id TEXT NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  queue_type TEXT NOT NULL CHECK (queue_type IN ('custom', 'offers_promotions', 'business_hours_location')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  general_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  automation_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_at TIMESTAMPTZ,
  published_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  UNIQUE (organization_id, queue_id, status),
  CHECK (jsonb_typeof(general_config) = 'object'),
  CHECK (jsonb_typeof(automation_config) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_queue_configurations_org_queue
  ON queue_configurations (organization_id, queue_id, status);

CREATE TABLE IF NOT EXISTS queue_configuration_history (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  queue_id TEXT NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  configuration_version INTEGER NOT NULL,
  action TEXT NOT NULL,
  previous_value JSONB,
  new_value JSONB,
  changed_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_queue_configuration_history_org_queue
  ON queue_configuration_history (organization_id, queue_id, created_at DESC);

-- Promoções já existem; estes campos as tornam conteúdo de uma fila e permitem
-- arquivamento auditável. O status legado segue compatível durante a transição.
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS queue_id TEXT REFERENCES queues(id);
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS caption TEXT;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0);
CREATE INDEX IF NOT EXISTS idx_promotions_org_queue_validity
  ON promotions (organization_id, queue_id, active, archived, starts_at, expires_at, display_order);

-- Uma unidade pode pertencer à fila de horário correspondente. Colunas legadas
-- continuam disponíveis para ambientes já migrados.
ALTER TABLE business_locations ADD COLUMN IF NOT EXISTS queue_id TEXT REFERENCES queues(id);
ALTER TABLE business_locations ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE business_locations ADD COLUMN IF NOT EXISTS unit_number TEXT;
ALTER TABLE business_locations ADD COLUMN IF NOT EXISTS complement TEXT;
ALTER TABLE business_locations ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE business_locations ADD COLUMN IF NOT EXISTS reference_point TEXT;
ALTER TABLE business_locations DROP CONSTRAINT IF EXISTS business_locations_organization_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_locations_org_queue
  ON business_locations (organization_id, queue_id) WHERE queue_id IS NOT NULL;

ALTER TABLE business_hours ADD COLUMN IF NOT EXISTS location_id TEXT REFERENCES business_locations(id) ON DELETE CASCADE;
ALTER TABLE business_hours ADD COLUMN IF NOT EXISTS second_start_time TEXT;
ALTER TABLE business_hours ADD COLUMN IF NOT EXISTS second_end_time TEXT;
ALTER TABLE business_hours DROP CONSTRAINT IF EXISTS business_hours_location_period_check;
ALTER TABLE business_hours ADD CONSTRAINT business_hours_location_period_check CHECK (
  (second_start_time IS NULL AND second_end_time IS NULL) OR
  (second_start_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' AND second_end_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' AND second_start_time < second_end_time)
);
CREATE INDEX IF NOT EXISTS idx_business_hours_org_location_day
  ON business_hours (organization_id, location_id, weekday);

ALTER TABLE business_special_hours ADD COLUMN IF NOT EXISTS location_id TEXT REFERENCES business_locations(id) ON DELETE CASCADE;
ALTER TABLE business_special_hours ADD COLUMN IF NOT EXISTS title TEXT;
CREATE INDEX IF NOT EXISTS idx_business_special_hours_org_location_date
  ON business_special_hours (organization_id, location_id, calendar_date);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['queue_configurations', 'queue_configuration_history'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS mavo_tenant_isolation_%I ON %I', table_name, table_name);
    EXECUTE format('CREATE POLICY mavo_tenant_isolation_%I ON %I USING (organization_id = mavo_current_organization_id()) WITH CHECK (organization_id = mavo_current_organization_id())', table_name, table_name);
  END LOOP;
END $$;

COMMIT;
