-- Mavo Talk: acesso gerencial pelo WhatsApp.
-- Rollback manual (somente se não houver dados): remover, nesta ordem,
-- business_access_audit, business_access_sessions e business_access_users.
BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS business_access_users (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name               TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 200),
  phone_normalized   TEXT NOT NULL CHECK (phone_normalized ~ '^[0-9]{10,15}$'),
  role               TEXT NOT NULL CHECK (role IN ('owner', 'director', 'manager', 'analyst')),
  permissions        JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(permissions) = 'object'),
  pin_hash           TEXT,
  mfa_type           TEXT NOT NULL DEFAULT 'pin'
                     CHECK (mfa_type IN ('pin', 'totp', 'email_code', 'external')),
  is_active          BOOLEAN NOT NULL DEFAULT true,
  failed_attempts    INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until       TIMESTAMPTZ,
  last_access_at     TIMESTAMPTZ,
  pin_changed_at     TIMESTAMPTZ,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, phone_normalized),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS business_access_sessions (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  access_user_id       TEXT NOT NULL,
  phone_normalized     TEXT NOT NULL CHECK (phone_normalized ~ '^[0-9]{10,15}$'),
  session_token_hash   TEXT NOT NULL UNIQUE,
  authenticated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ NOT NULL,
  support_mode_until   TIMESTAMPTZ,
  revoked_at           TIMESTAMPTZ,
  revoke_reason        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_business_session_user_tenant
    FOREIGN KEY (access_user_id, organization_id)
    REFERENCES business_access_users(id, organization_id)
    ON DELETE CASCADE,
  CONSTRAINT ck_business_session_expiry
    CHECK (expires_at > authenticated_at)
);

CREATE TABLE IF NOT EXISTS business_access_audit (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  access_user_id     TEXT,
  phone_normalized   TEXT CHECK (phone_normalized IS NULL OR phone_normalized ~ '^[0-9]{10,15}$'),
  event_type         TEXT NOT NULL CHECK (
    event_type IN (
      'challenge_requested', 'authentication_succeeded', 'authentication_failed',
      'access_locked', 'access_unlocked', 'session_expired', 'session_revoked',
      'support_mode_started', 'support_mode_ended', 'access_created',
      'access_updated', 'access_deactivated', 'pin_reset'
    )
  ),
  source             TEXT NOT NULL DEFAULT 'whatsapp'
                     CHECK (source IN ('whatsapp', 'ui', 'api', 'system')),
  request_id         TEXT,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_business_access_audit_user_tenant
    FOREIGN KEY (access_user_id, organization_id)
    REFERENCES business_access_users(id, organization_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS business_whatsapp_events (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  event_id           TEXT NOT NULL,
  access_user_id     TEXT NOT NULL,
  phone_normalized   TEXT NOT NULL CHECK (phone_normalized ~ '^[0-9]{10,15}$'),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, event_id),
  CONSTRAINT fk_business_whatsapp_event_user_tenant
    FOREIGN KEY (access_user_id, organization_id)
    REFERENCES business_access_users(id, organization_id)
    ON DELETE RESTRICT
);

COMMIT;
