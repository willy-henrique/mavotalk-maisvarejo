import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hashTokenRecuperacao, TOKEN_EXPIRY_MS } from "../../lib/metrics/password-reset";

const MIGRACAO = "supabase/migrations/202608240022_password_reset_tokens.sql";

test("token de recuperacao expira em exatamente 30 minutos", () => {
  assert.equal(TOKEN_EXPIRY_MS, 30 * 60 * 1000);
});

test("somente o SHA-256 do token e persistido", () => {
  const token = "token-de-teste-com-entropia-suficiente-123456789";
  const hash = hashTokenRecuperacao(token);
  assert.equal(hash.length, 64);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
});

test("migracao armazena hash, tenant, expiracao e uso", async () => {
  const fonte = await readFile(MIGRACAO, "utf8");
  assert.match(fonte, /CREATE TABLE IF NOT EXISTS password_reset_tokens/);
  assert.match(fonte, /token_hash\s+TEXT\s+NOT NULL\s+UNIQUE/);
  assert.match(fonte, /user_id\s+TEXT\s+NOT NULL/);
  assert.match(fonte, /organization_id\s+TEXT\s+NOT NULL/);
  assert.match(fonte, /expires_at\s+TIMESTAMPTZ\s+NOT NULL/);
  assert.match(fonte, /used_at\s+TIMESTAMPTZ/);
  assert.doesNotMatch(fonte, /\btoken\s+TEXT/i);
});

test("tabela tem RLS e chave estrangeira composta de tenant", async () => {
  const fonte = await readFile(MIGRACAO, "utf8");
  assert.match(fonte, /ENABLE ROW LEVEL SECURITY/);
  assert.match(fonte, /organization_id = mavo_current_organization_id\(\)/);
  assert.match(fonte, /FOREIGN KEY \(user_id, organization_id\)/);
  assert.match(fonte, /REFERENCES users\(id, organization_id\)/);
});

test("criacao serializa por usuario e invalida pedidos anteriores", async () => {
  const fonte = await readFile("lib/metrics/password-reset.ts", "utf8");
  assert.match(fonte, /randomBytes\(32\)/);
  assert.match(fonte, /FOR UPDATE/);
  assert.match(fonte, /UPDATE password_reset_tokens/);
  assert.match(fonte, /organization_id = \$1/);
  assert.match(fonte, /INSERT INTO password_reset_tokens/);
  assert.match(fonte, /token_hash/);
});

test("consumo e atomico, de uso unico e atualiza a senha no mesmo tenant", async () => {
  const fonte = await readFile("lib/metrics/password-reset.ts", "utf8");
  assert.match(fonte, /withTenantTransaction/);
  assert.match(fonte, /used_at IS NULL/);
  assert.match(fonte, /expires_at > \$3/);
  assert.match(fonte, /UPDATE users/);
  assert.match(fonte, /password_hash/);
  assert.match(fonte, /user_account\.organization_id = \$1/);
});

test("servico nunca registra token ou senha em log", async () => {
  const fonte = await readFile("lib/metrics/password-reset.ts", "utf8");
  assert.doesNotMatch(fonte, /console\.(log|info|warn|error)/);
  assert.doesNotMatch(fonte, /logger\.(info|warn|error)/);
});
