-- Visibilidade dos itens do menu lateral, configurável por organização.
-- Guarda apenas os overrides explícitos; itens/perfis ausentes usam o
-- padrão embutido no código (ver lib/menu-settings.ts).
BEGIN;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS menu_visibility_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
