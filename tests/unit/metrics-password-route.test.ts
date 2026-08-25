import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const FORGOT = "app/api/metrics/v1/auth/password/forgot/route.ts";
const RESET = "app/api/metrics/v1/auth/password/reset/route.ts";

test("recuperacao usa telefone dedicado e nunca tenta adivinhar o destinatario", async () => {
  const [migracao, servico] = await Promise.all([
    readFile("supabase/migrations/202608240022_password_reset_tokens.sql", "utf8"),
    readFile("lib/metrics/password-reset.ts", "utf8"),
  ]);
  assert.match(migracao, /ADD COLUMN IF NOT EXISTS recovery_phone/);
  assert.match(migracao, /recovery_phone[\s\S]*\^\[0-9\]\{10,15\}/);
  assert.match(servico, /recovery_phone/);
  assert.match(servico, /organization_id = \$1/);
  assert.doesNotMatch(servico, /contacts|business_access_users/);
});

test("forgot exige token de servico e aplica rate limit antes da identidade", async () => {
  const fonte = await readFile(FORGOT, "utf8");
  const posServico = fonte.indexOf("metricsServiceTokenIsValid");
  const posLimite = fonte.indexOf("consumeRateLimit");
  const posUsuario = fonte.indexOf("getUserByEmail");
  assert.ok(posServico > -1 && posLimite > posServico && posUsuario > posLimite);
});

test("forgot nao enumera email, papel, telefone ou falha de entrega", async () => {
  const fonte = await readFile(FORGOT, "utf8");
  assert.match(fonte, /RESPOSTA_ACEITA/);
  assert.match(fonte, /respostaAceita/);
  assert.doesNotMatch(fonte, /usuário não encontrado|usuario nao encontrado|e-mail não existe/i);
  assert.doesNotMatch(fonte, /return metricsError\("internal"/);
});

test("link e entregue pelo adaptador do canal WhatsApp existente", async () => {
  const [rota, entrega] = await Promise.all([
    readFile(FORGOT, "utf8"),
    readFile("lib/metrics/password-reset-delivery.ts", "utf8"),
  ]);
  assert.match(rota, /entregarRecuperacaoPorWhatsApp/);
  assert.match(entrega, /sendWhatsappMessage/);
  assert.match(entrega, /twilio/);
  assert.match(entrega, /MAVO_MANAGEMENT_URL/);
  assert.match(entrega, /redefinir/);
});

test("reset exige senha de 10 caracteres e usa bcrypt", async () => {
  const fonte = await readFile(RESET, "utf8");
  assert.match(fonte, /min\(10/);
  assert.match(fonte, /max\(128/);
  assert.match(fonte, /bcrypt\.hash/);
  assert.match(fonte, /consumirTokenRecuperacao/);
});

test("reset limita tentativas e trata token expirado sem detalhe interno", async () => {
  const fonte = await readFile(RESET, "utf8");
  assert.match(fonte, /consumeRateLimit/);
  assert.match(fonte, /invalid_request/);
  assert.match(fonte, /inválido ou expirado/i);
  assert.doesNotMatch(fonte, /erro\.stack|passwordHash/);
});

test("rotas nunca registram token, email ou senha", async () => {
  const fonte = `${await readFile(FORGOT, "utf8")}\n${await readFile(RESET, "utf8")}`;
  assert.doesNotMatch(fonte, /console\.(log|info|warn|error)/);
  assert.doesNotMatch(fonte, /logger\.(info|warn|error)\([^)]*(token|email|password|senha)/i);
});
