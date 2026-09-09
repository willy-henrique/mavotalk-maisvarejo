ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS default_queue_id TEXT REFERENCES queues(id) ON DELETE SET NULL;

-- Remove constraint de queues e adiciona com webhook
ALTER TABLE queues DROP CONSTRAINT IF EXISTS queues_queue_type_check;

ALTER TABLE queues ADD CONSTRAINT queues_queue_type_check
  CHECK (queue_type IN ('custom', 'offers_promotions', 'business_hours_location', 'webhook'));

-- Ajusta queue_configurations se houver check de queue_type
ALTER TABLE queue_configurations DROP CONSTRAINT IF EXISTS queue_configurations_queue_type_check;

ALTER TABLE queue_configurations ADD CONSTRAINT queue_configurations_queue_type_check
  CHECK (queue_type IN ('custom', 'offers_promotions', 'business_hours_location', 'webhook'));
