import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  validateApiEnvironment,
  validateWorkerEnvironment,
}: {
  validateApiEnvironment(environment: NodeJS.ProcessEnv): void;
  validateWorkerEnvironment(environment: NodeJS.ProcessEnv): void;
} = require("../../lib/config/runtime-env.cjs");

const databaseUrl = "postgresql://user:password@example.test:5432/database";

test("ambiente de produção exige Supabase, Redis e segredo JWT forte", () => {
  assert.throws(
    () =>
      validateApiEnvironment({
        NODE_ENV: "production",
        DB_PROVIDER: "firestore",
        JWT_SECRET: "curto",
      }),
    /Configuração de produção inválida/,
  );
});

test("ambiente da API valida chave de cifra e disco persistente", () => {
  assert.doesNotThrow(() =>
    validateApiEnvironment({
      NODE_ENV: "production",
      DB_PROVIDER: "supabase",
      DATABASE_URL_RUNTIME: databaseUrl,
      REDIS_URL: "rediss://default:secret@example.test:6379",
      JWT_SECRET: "x".repeat(32),
      MAVO_ALLOWED_ORIGINS: "https://app.example.test",
      MAVO_AGENT_API_ENABLED: "true",
      MAVO_AGENT_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString(
        "base64",
      ),
      WHATSAPP_PROVIDER: "unofficial",
      WHATSAPP_AUTH_PATH: "/var/data/wwebjs_auth",
      RENDER_DISK_PATH: "/var/data",
      RENDER: "true",
    }),
  );
  assert.throws(
    () =>
      validateApiEnvironment({
        NODE_ENV: "production",
        DB_PROVIDER: "supabase",
        DATABASE_URL_RUNTIME: databaseUrl,
        REDIS_URL: "rediss://default:secret@example.test:6379",
        JWT_SECRET: "x".repeat(32),
        MAVO_ALLOWED_ORIGINS: "https://app.example.test",
        MAVO_AGENT_API_ENABLED: "true",
        MAVO_AGENT_CREDENTIAL_ENCRYPTION_KEY: "não-é-uma-chave",
        WHATSAPP_PROVIDER: "unofficial",
        WHATSAPP_AUTH_PATH: "/tmp/wwebjs_auth",
        RENDER_DISK_PATH: "/var/data",
        RENDER: "true",
      }),
    /MAVO_AGENT_CREDENTIAL_ENCRYPTION_KEY/,
  );
});

test("sessão efêmera do WhatsApp exige opt-in explícito no Render", () => {
  const semDisco: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    DB_PROVIDER: "supabase",
    DATABASE_URL_RUNTIME: databaseUrl,
    REDIS_URL: "rediss://default:secret@example.test:6379",
    JWT_SECRET: "x".repeat(32),
    MAVO_ALLOWED_ORIGINS: "https://app.example.test",
    WHATSAPP_PROVIDER: "unofficial",
    WHATSAPP_AUTH_PATH: "/tmp/wwebjs_auth",
    RENDER: "true",
  };

  assert.throws(
    () => validateApiEnvironment(semDisco),
    /WHATSAPP_AUTH_PATH/,
    "sem disco e sem opt-in deve falhar fechado",
  );

  assert.doesNotThrow(() =>
    validateApiEnvironment({
      ...semDisco,
      WHATSAPP_ALLOW_EPHEMERAL_SESSION: "true",
    }),
  );

  assert.throws(
    () =>
      validateApiEnvironment({
        ...semDisco,
        WHATSAPP_ALLOW_EPHEMERAL_SESSION: "true",
        WHATSAPP_AUTH_PATH: "wwebjs_auth",
      }),
    /WHATSAPP_AUTH_PATH/,
    "o opt-in não dispensa caminho absoluto",
  );
});

test("worker falha fechado sem Redis em produção", () => {
  assert.throws(
    () =>
      validateWorkerEnvironment({
        NODE_ENV: "production",
        DB_PROVIDER: "supabase",
        DATABASE_URL_RUNTIME: databaseUrl,
      }),
    /Configuração do worker inválida/,
  );
});
