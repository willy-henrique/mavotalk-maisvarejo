-- Mavo Talk — baseline legado do schema Supabase/PostgreSQL.
-- Mantido para compatibilidade com instalações anteriores. Em instalações e
-- atualizações novas, a fonte autoritativa é supabase/migrations/ e os comandos
-- npm run db:migrate / npm run db:verify.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'gestor', 'atendente');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE conversation_status AS ENUM ('aguardando', 'em_atendimento', 'pendente_cliente', 'encerrado');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE message_type AS ENUM ('text', 'image', 'document', 'audio');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name          TEXT NOT NULL DEFAULT 'Organização',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id  TEXT NOT NULL REFERENCES organizations(id),
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  role             user_role NOT NULL DEFAULT 'atendente',
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));

-- Queues
CREATE TABLE IF NOT EXISTS queues (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id   TEXT NOT NULL REFERENCES organizations(id),
  name              TEXT NOT NULL,
  menu_option       INTEGER NOT NULL DEFAULT 0,
  color_hex         TEXT NOT NULL DEFAULT '#64748B',
  default_sla_mins  INTEGER NOT NULL DEFAULT 30,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_queues_org_menu_option
  ON queues (organization_id, menu_option);

-- Contacts
CREATE TABLE IF NOT EXISTS contacts (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id  TEXT NOT NULL REFERENCES organizations(id),
  phone_number     TEXT NOT NULL,
  name             TEXT NOT NULL DEFAULT 'Contato',
  avatar_url       TEXT,
  blocked          BOOLEAN NOT NULL DEFAULT false,
  bot_disabled     BOOLEAN NOT NULL DEFAULT false,
  internal_note    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_org_phone
  ON contacts (organization_id, phone_number);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id   TEXT NOT NULL REFERENCES organizations(id),
  contact_id        TEXT NOT NULL REFERENCES contacts(id),
  contact_phone     TEXT,
  queue_id          TEXT REFERENCES queues(id),
  status            conversation_status NOT NULL DEFAULT 'aguardando',
  triage_completed  BOOLEAN NOT NULL DEFAULT false,
  menu_attempts     INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_conversations_org_status
  ON conversations (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_contact
  ON conversations (organization_id, contact_id);

-- Tickets
CREATE TABLE IF NOT EXISTS tickets (
  id                     TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id        TEXT NOT NULL REFERENCES organizations(id),
  conversation_id        TEXT NOT NULL REFERENCES conversations(id),
  queue_id               TEXT REFERENCES queues(id),
  assignee_id            TEXT REFERENCES users(id),
  close_reason           TEXT,
  satisfaction_score     INTEGER,
  satisfaction_rated_at  TIMESTAMPTZ,
  first_response_at      TIMESTAMPTZ,
  first_response_due_at  TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at              TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_conversation
  ON tickets (conversation_id);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id       TEXT NOT NULL REFERENCES organizations(id),
  conversation_id       TEXT NOT NULL REFERENCES conversations(id),
  direction             message_direction NOT NULL,
  type                  message_type NOT NULL DEFAULT 'text',
  content               TEXT NOT NULL DEFAULT '',
  external_id           TEXT,
  author_id             TEXT REFERENCES users(id),
  media_url             TEXT,
  mime_type             TEXT,
  cloudinary_public_id  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_org_created
  ON messages (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_external_id
  ON messages (organization_id, external_id) WHERE external_id IS NOT NULL;

-- Quick Replies
CREATE TABLE IF NOT EXISTS quick_replies (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id  TEXT NOT NULL REFERENCES organizations(id),
  name             TEXT NOT NULL,
  content          TEXT NOT NULL DEFAULT '',
  category         TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id  TEXT NOT NULL REFERENCES organizations(id),
  user_id          TEXT,
  action           TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Business Hours
CREATE TABLE IF NOT EXISTS business_hours (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id  TEXT NOT NULL REFERENCES organizations(id),
  weekday          INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time       TEXT NOT NULL DEFAULT '08:00',
  end_time         TEXT NOT NULL DEFAULT '18:00',
  timezone         TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  is_active        BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_hours_org_day
  ON business_hours (organization_id, weekday);

-- Channels (for Twilio routing)
CREATE TABLE IF NOT EXISTS channels (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id       TEXT NOT NULL REFERENCES organizations(id),
  twilio_phone_number   TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT true
);

-- Impede acesso pelo Data API público. O backend do Mavo Talk usa a conexão
-- PostgreSQL segura do Render (ou a service role) e continua com acesso.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
