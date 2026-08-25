-- Última vez que o atendente esteve no painel.
--
-- Diferente de last_login_at, que responde "quando entrou". Este responde
-- "quando esteve aqui pela última vez", e é gravado quando a última aba do
-- atendente se desconecta do socket.
--
-- A presença ao vivo vive na memória do processo (lib/presence.cjs). Esta
-- coluna existe porque o serviço no plano gratuito do Render hiberna após 15
-- minutos sem tráfego e volta com a memória zerada: sem persistir, toda a
-- equipe apareceria como "offline, nunca visto" depois de cada soneca.
--
-- Aditiva: pode ser removida com ALTER TABLE users DROP COLUMN last_seen_at.
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_users_organization_last_seen
  ON users (organization_id, last_seen_at DESC);

COMMIT;
