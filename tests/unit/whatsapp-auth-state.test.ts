import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  decryptWhatsappAuthValue,
  encryptWhatsappAuthValue,
} from "../../lib/whatsapp-auth-crypto";
import {
  configuredWhatsappAuthPersistence,
  configuredWhatsappAuthStore,
  shouldAutoReconnectWhatsapp,
} from "../../lib/whatsapp-auth-config";

const encryptionKey = "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres";
const context = "org_test\u001fmavo-production\u001fsession\u001f5511999";

test("cifra e recupera valores binários do auth state do Baileys", () => {
  const encrypted = encryptWhatsappAuthValue(
    {
      privateKey: Buffer.from([1, 2, 3, 4]),
      session: new Uint8Array([5, 6, 7]),
      registered: true,
    },
    encryptionKey,
    context,
  );
  const decrypted = decryptWhatsappAuthValue<{
    privateKey: Buffer;
    session: Buffer;
    registered: boolean;
  }>(encrypted, encryptionKey, context);

  assert.deepEqual(decrypted.privateKey, Buffer.from([1, 2, 3, 4]));
  assert.deepEqual(decrypted.session, Buffer.from([5, 6, 7]));
  assert.equal(decrypted.registered, true);
  assert.doesNotMatch(encrypted.ciphertext, /registered|privateKey/);
});

test("AES-GCM recusa chave, contexto ou conteúdo adulterado", () => {
  const encrypted = encryptWhatsappAuthValue(
    { registered: false },
    encryptionKey,
    context,
  );

  assert.throws(() =>
    decryptWhatsappAuthValue(
      encrypted,
      encryptionKey,
      `${context}-outro`,
    ),
  );
  assert.throws(() =>
    decryptWhatsappAuthValue(
      {
        ...encrypted,
        ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA`,
      },
      encryptionKey,
      context,
    ),
  );
  assert.throws(
    () => encryptWhatsappAuthValue({}, "chave-curta", context),
    /ao menos 32 caracteres/,
  );
});

test("classifica store SQL como persistente e filesystem efêmero corretamente", () => {
  assert.equal(
    configuredWhatsappAuthStore({ WHATSAPP_AUTH_STORE: "database" }),
    "database",
  );
  assert.equal(
    configuredWhatsappAuthPersistence({
      WHATSAPP_AUTH_STORE: "database",
    }),
    true,
  );
  assert.equal(
    configuredWhatsappAuthPersistence({
      WHATSAPP_AUTH_STORE: "filesystem",
      WHATSAPP_AUTH_PATH: "/tmp/whatsapp_auth",
    }),
    false,
  );
  assert.equal(
    configuredWhatsappAuthPersistence({
      WHATSAPP_AUTH_STORE: "filesystem",
      WHATSAPP_AUTH_PATH: "/var/data/whatsapp_auth",
      RENDER_DISK_PATH: "/var/data",
    }),
    true,
  );
});

test("reconecta apenas quedas transitórias, nunca logout ou parada manual", () => {
  assert.equal(shouldAutoReconnectWhatsapp(false, false), true);
  assert.equal(shouldAutoReconnectWhatsapp(true, false), false);
  assert.equal(shouldAutoReconnectWhatsapp(false, true), false);
});

test("migration cria tabela cifrada com isolamento RLS e verificação de deploy", async () => {
  const migration = await readFile(
    "supabase/migrations/202607240006_whatsapp_auth_state.sql",
    "utf8",
  );
  const verifier = await readFile("scripts/db-verify.mjs", "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS whatsapp_auth_state/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /mavo_current_organization_id\(\)/);
  assert.doesNotMatch(migration, /payload|plaintext|jsonb/i);
  assert.match(verifier, /"whatsapp_auth_state"/);
});
