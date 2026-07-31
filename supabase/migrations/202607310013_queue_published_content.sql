-- Separa o conteúdo em edição da fotografia publicada utilizada pelo bot.
-- A configuração publicada sempre aponta para um snapshot imutável até a
-- próxima publicação, portanto salvar rascunho nunca muda o atendimento real.
BEGIN;

ALTER TABLE queue_configurations
  ADD COLUMN IF NOT EXISTS content_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'queue_configurations_content_snapshot_object'
       AND conrelid = 'queue_configurations'::regclass
  ) THEN
    ALTER TABLE queue_configurations
      ADD CONSTRAINT queue_configurations_content_snapshot_object
      CHECK (jsonb_typeof(content_snapshot) = 'object');
  END IF;
END $$;

ALTER TABLE promotions ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS published_active BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS published_archived BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_promotions_published_validity
  ON promotions (organization_id, queue_id, published_at, published_active, published_archived, starts_at, expires_at);

COMMIT;
