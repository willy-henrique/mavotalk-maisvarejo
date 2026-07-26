/**
 * Gera uma nova chave JWT_SECRET ou um token de sessão.
 *
 * Uso:
 *   node scripts/jwt-secret.mjs
 *     → Imprime uma nova JWT_SECRET para colar no .env
 *
 *   node scripts/jwt-secret.mjs --token
 *     → Gera um token de sessão (usa JWT_SECRET e DEFAULT_ORG_ID do .env).
 *       Coloque no cookie "willtalk_session" para autenticar no Painel.
 *
 *   node scripts/jwt-secret.mjs --token --userId=abc --email=admin@exemplo.com --role=admin --name=Admin
 *     → Token com dados do usuário (role: admin | gestor | atendente).
 */

import crypto from "node:crypto";
import "dotenv/config";

const JWT_SECRET_ENV = process.env.JWT_SECRET || "dev_secret_change_me";
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID || "org_willtalk-40733";

function generateSecret() {
  return crypto.randomBytes(32).toString("hex");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const token = args.includes("--token");
  const userId = args.find((a) => a.startsWith("--userId="))?.slice("--userId=".length) || "admin-dev";
  const email = args.find((a) => a.startsWith("--email="))?.slice("--email=".length) || "admin@willtalk.local";
  const name = args.find((a) => a.startsWith("--name="))?.slice("--name=".length) || "Administrador";
  const role = args.find((a) => a.startsWith("--role="))?.slice("--role=".length) || "admin";
  return { token, userId, email, name, role };
}

async function generateSessionToken(payload) {
  const { SignJWT } = await import("jose");
  const secret = new TextEncoder().encode(JWT_SECRET_ENV);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret);
}

async function main() {
  const { token, userId, email, name, role } = parseArgs();

  if (token) {
    const validRole = ["admin", "gestor", "atendente"].includes(role) ? role : "admin";
    const sessionToken = await generateSessionToken({
      userId,
      organizationId: DEFAULT_ORG_ID,
      role: validRole,
      name,
      email,
    });
    console.log("\n--- Token de sessão (cookie willtalk_session) ---\n");
    console.log(sessionToken);
    console.log("\nNo DevTools (F12) → Application → Cookies → adicione:");
    console.log("  Nome: willtalk_session");
    console.log("  Valor: (cole o token acima)");
    console.log("  Path: /\n");
    return;
  }

  const newSecret = generateSecret();
  console.log("\n--- Nova JWT_SECRET (adicione no .env) ---\n");
  console.log(`JWT_SECRET="${newSecret}"`);
  console.log("\nCopie a linha acima para o arquivo .env e reinicie o servidor.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
