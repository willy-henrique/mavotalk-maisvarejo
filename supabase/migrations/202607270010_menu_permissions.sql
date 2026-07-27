-- Matriz de permissões por organização e recurso do painel.
-- A coluna contém somente overrides; o padrão seguro continua definido no
-- servidor para que uma migration parcial nunca libere acesso indevido.
BEGIN;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS menu_permission_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
