import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const COLECAO = "app/api/metrics/v1/users/route.ts";
const ITEM = "app/api/metrics/v1/users/[id]/route.ts";
const ADAPTER = "lib/management/users-adapter.ts";

test("todas as operacoes exigem guard e papel admin", async () => {
  const [colecao, item] = await Promise.all([readFile(COLECAO, "utf8"), readFile(ITEM, "utf8")]);
  for (const fonte of [colecao, item]) {
    assert.match(fonte, /requireMetricsAccess/);
    assert.match(fonte, /session\.role !== "admin"/);
    assert.match(fonte, /forbidden/);
    assert.match(fonte, /session\.organizationId/);
  }
});

test("rotas nunca aceitam empresa da requisicao", async () => {
  const fonte = `${await readFile(COLECAO, "utf8")}\n${await readFile(ITEM, "utf8")}`;
  assert.doesNotMatch(fonte, /searchParams\.get\([^)]*(org|organization|empresa)/i);
  assert.doesNotMatch(fonte, /headers\.get\([^)]*x-organization/i);
  assert.doesNotMatch(fonte, /corpo\.(organizationId|organization_id|empresa)/);
});

test("adapter filtra tenant em leitura, escrita e auditoria", async () => {
  const fonte = await readFile(ADAPTER, "utf8");
  const filtros = fonte.match(/organization_id = \$1/g) || [];
  assert.ok(filtros.length >= 5, "toda operação precisa do filtro explícito de tenant");
  assert.match(fonte, /queryTenantDatabase/);
  assert.match(fonte, /withTenantTransaction/);
  assert.match(fonte, /INSERT INTO audit_logs/);
});

test("criacao valida senha forte, hash bcrypt e telefone de recuperacao", async () => {
  const fonte = await readFile(COLECAO, "utf8");
  assert.match(fonte, /min\(10/);
  assert.match(fonte, /max\(128/);
  assert.match(fonte, /bcrypt\.hash/);
  assert.match(fonte, /recoveryPhone/);
  assert.doesNotMatch(fonte, /password_hash/);
});

test("atualizacao protege a propria conta e a ultima conta admin", async () => {
  const [rota, adapter] = await Promise.all([readFile(ITEM, "utf8"), readFile(ADAPTER, "utf8")]);
  assert.match(rota, /session\.userId/);
  assert.match(adapter, /própria conta administrativa/i);
  assert.match(adapter, /last_active_admin/);
});

test("delete desativa em vez de apagar e resposta nunca traz hash", async () => {
  const [rota, adapter] = await Promise.all([readFile(ITEM, "utf8"), readFile(ADAPTER, "utf8")]);
  assert.match(rota, /desativarUsuarioGerenciado/);
  assert.doesNotMatch(adapter, /DELETE FROM users/);
  assert.doesNotMatch(rota, /passwordHash|password_hash/);
});

test("telefone fica restrito ao formato internacional e gestor nao cria usuarios", async () => {
  const [migracao, colecao] = await Promise.all([
    readFile("supabase/migrations/202608240022_password_reset_tokens.sql", "utf8"),
    readFile(COLECAO, "utf8"),
  ]);
  assert.match(migracao, /recovery_phone[\s\S]*10,15/);
  assert.match(colecao, /session\.role !== "admin"/);
});
