-- Configuração operacional do bot por organização.
-- Mantém variáveis de ambiente como fallback para instalações legadas.
BEGIN;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bot_enabled BOOLEAN;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bot_name TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS store_name TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bot_address TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bot_maps_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bot_weekday_hours TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bot_sunday_hours TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bot_offers_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bot_offers_text TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bot_offers_image_url TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bot_offers_image_public_id TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bot_phone TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bot_ai_fallback_enabled BOOLEAN;

-- Migra o menu legado que continha "Entregas e pedidos" para a sequência
-- atual sem colidir com o índice único de menu_option.
UPDATE queues SET menu_option = menu_option + 100
 WHERE menu_option BETWEEN 3 AND 7;
UPDATE queues SET menu_option = CASE menu_option
  WHEN 103 THEN 103
  WHEN 104 THEN 3
  WHEN 105 THEN 4
  WHEN 106 THEN 5
  WHEN 107 THEN 6
  ELSE menu_option END;
UPDATE queues SET is_active = false
 WHERE menu_option = 103;

COMMIT;
