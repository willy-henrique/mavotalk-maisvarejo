import "dotenv/config";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { createMigrationPool } from "./db-common.mjs";

// Cria o primeiro usuário de equipe (tabela `users`, autenticação de
// /api/auth/login) para a organização de DEFAULT_ORG_ID.
//
// Por que este script existe: db:bootstrap:production cria só a organização;
// db:seed:development é proibido em produção (NODE_ENV=production) e, mesmo
// em dev, cria outra organização com dados fictícios. Sem usuário na tabela
// `users`, ninguém consegue logar em /login — e como /api/admin/users (que
// cria usuários pelo painel) exige uma sessão de equipe já autenticada, é
// impossível sair desse estado pela própria aplicação. Este script é o
// único caminho para o primeiro usuário.
//
// Rode uma vez, da sua máquina, apontando DATABASE_URL_RUNTIME para o banco
// de produção (não roda no build do Render: senha em texto claro não deve
// passar por variável de build). Depois do primeiro admin, use o painel.
//
// Uso:
//   TEAM_ADMIN_NAME="Seu Nome" \
//   TEAM_ADMIN_EMAIL="voce@maisvarejo.com.br" \
//   TEAM_ADMIN_PASSWORD="senha-forte-aqui" \
//   npm run db:create-admin

const VALID_ROLES = new Set(["admin", "gestor", "atendente"]);

function normalized(value) {
  return String(value || "").trim();
}

const name = normalized(process.env.TEAM_ADMIN_NAME);
const email = normalized(process.env.TEAM_ADMIN_EMAIL).toLowerCase();
const password = normalized(process.env.TEAM_ADMIN_PASSWORD);
const role = normalized(process.env.TEAM_ADMIN_ROLE) || "admin";
const organizationId =
  normalized(process.env.DEFAULT_ORG_ID) || "org_willtalk_default";

if (name.length < 2 || name.length > 120) {
  throw new Error("TEAM_ADMIN_NAME deve conter entre 2 e 120 caracteres");
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
  throw new Error("TEAM_ADMIN_EMAIL inválido");
}
if (password.length < 8 || password.length > 200) {
  throw new Error("TEAM_ADMIN_PASSWORD deve conter entre 8 e 200 caracteres");
}
if (!VALID_ROLES.has(role)) {
  throw new Error(`TEAM_ADMIN_ROLE deve ser um de: ${[...VALID_ROLES].join(", ")}`);
}

const pool = createMigrationPool();
const client = await pool.connect();
try {
  const org = await client.query("SELECT id FROM organizations WHERE id = $1", [
    organizationId,
  ]);
  if (org.rowCount === 0) {
    throw new Error(
      `Organização ${organizationId} não existe. Rode "npm run db:bootstrap:production" primeiro.`,
    );
  }

  const existing = await client.query(
    "SELECT id FROM users WHERE LOWER(email) = $1",
    [email],
  );
  if (existing.rowCount > 0) {
    console.log(
      `Já existe um usuário com o e-mail ${email}. Nada foi alterado. ` +
        "Para trocar a senha, use o painel (uma vez logado) ou um script de reset dedicado.",
    );
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await client.query(
    `INSERT INTO users (id, organization_id, name, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, true)`,
    [randomUUID(), organizationId, name, email, passwordHash, role],
  );

  console.log(
    JSON.stringify({
      status: "ok",
      organizationId,
      email,
      role,
    }),
  );
  console.log("Usuário criado. A senha não foi exibida nem armazenada em log.");
} finally {
  client.release();
  await pool.end();
}
