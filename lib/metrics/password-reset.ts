import { createHash, randomBytes } from "node:crypto";
import {
  queryDatabase,
  queryTenantDatabase,
  requireTenantOrganizationId,
  withTenantTransaction,
} from "@/lib/db";

export const TOKEN_EXPIRY_MS = 30 * 60 * 1000;

export type TokenRecuperacao = {
  token: string;
  expiresAt: string;
};

type OrganizacaoDoToken = { organization_id: string };
type TokenConsumido = { user_id: string };
type TelefoneRecuperacao = { recovery_phone: string | null };

function instanteValido(agora: Date): Date {
  if (Number.isNaN(agora.getTime())) throw new Error("Instante de recuperação inválido");
  return agora;
}

function idValido(valor: string, campo: string): string {
  const normalizado = String(valor || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(normalizado)) {
    throw new Error(`${campo} inválido`);
  }
  return normalizado;
}

function tokenTemFormatoValido(token: string): boolean {
  return /^[A-Za-z0-9_-]{40,512}$/.test(token);
}

function hashBcryptValido(hash: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(hash) && hash.length <= 255;
}

export function hashTokenRecuperacao(token: string): string {
  if (!token || token.length > 512) throw new Error("Token de recuperação inválido");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function telefoneParaRecuperacao(
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const orgId = requireTenantOrganizationId(organizationId);
  const usuarioId = idValido(userId, "Usuário");
  const resultado = await queryTenantDatabase<TelefoneRecuperacao>(
    orgId,
    `SELECT recovery_phone
       FROM users
      WHERE organization_id = $1
        AND id = $2
        AND is_active = true`,
    [orgId, usuarioId],
  );
  const telefone = String(resultado.rows[0]?.recovery_phone ?? "").trim();
  return /^[0-9]{10,15}$/.test(telefone) ? telefone : null;
}

export async function criarTokenRecuperacao(
  organizationId: string,
  userId: string,
  agora = new Date(),
): Promise<TokenRecuperacao> {
  const orgId = requireTenantOrganizationId(organizationId);
  const usuarioId = idValido(userId, "Usuário");
  const criadoEm = instanteValido(agora);
  const expiraEm = new Date(criadoEm.getTime() + TOKEN_EXPIRY_MS);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashTokenRecuperacao(token);

  await withTenantTransaction(orgId, async (client) => {
    const usuario = await client.query<{ id: string }>(
      `SELECT id
         FROM users
        WHERE organization_id = $1
          AND id = $2
          AND is_active = true
        FOR UPDATE`,
      [orgId, usuarioId],
    );
    if (usuario.rowCount !== 1) throw new Error("Usuário não disponível para recuperação");

    await client.query(
      `UPDATE password_reset_tokens
          SET used_at = $3
        WHERE organization_id = $1
          AND user_id = $2
          AND used_at IS NULL`,
      [orgId, usuarioId, criadoEm.toISOString()],
    );

    await client.query(
      `INSERT INTO password_reset_tokens (
         organization_id, user_id, token_hash, expires_at, created_at
       ) VALUES ($1, $2, $3, $4, $5)`,
      [orgId, usuarioId, tokenHash, expiraEm.toISOString(), criadoEm.toISOString()],
    );
  });

  return { token, expiresAt: expiraEm.toISOString() };
}

/**
 * A consulta inicial resolve somente o tenant ligado ao segredo opaco. Ela é a
 * etapa anônima equivalente à busca global de e-mail do login; nenhum dado da
 * conta é devolvido ao chamador. A alteração acontece depois sob RLS estrita.
 */
async function organizacaoDoToken(tokenHash: string, agora: Date): Promise<string | null> {
  const resultado = await queryDatabase<OrganizacaoDoToken>(
    `SELECT organization_id
       FROM password_reset_tokens
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > $2
      LIMIT 1`,
    [tokenHash, agora.toISOString()],
  );
  const organizationId = resultado.rows[0]?.organization_id;
  return organizationId ? requireTenantOrganizationId(organizationId) : null;
}

export async function consumirTokenRecuperacao(
  token: string,
  passwordHash: string,
  agora = new Date(),
): Promise<boolean> {
  if (!tokenTemFormatoValido(token) || !hashBcryptValido(passwordHash)) return false;
  const usadoEm = instanteValido(agora);
  const tokenHash = hashTokenRecuperacao(token);
  const orgId = await organizacaoDoToken(tokenHash, usadoEm);
  if (!orgId) return false;

  return withTenantTransaction(orgId, async (client) => {
    const tokenConsumido = await client.query<TokenConsumido>(
      `UPDATE password_reset_tokens
          SET used_at = $3
        WHERE organization_id = $1
          AND token_hash = $2
          AND used_at IS NULL
          AND expires_at > $3
      RETURNING user_id`,
      [orgId, tokenHash, usadoEm.toISOString()],
    );
    const userId = tokenConsumido.rows[0]?.user_id;
    if (!userId) return false;

    const usuarioAtualizado = await client.query<{ id: string }>(
      `UPDATE users AS user_account
          SET password_hash = $3,
              updated_at = $4
        WHERE user_account.organization_id = $1
          AND user_account.id = $2
          AND user_account.is_active = true
      RETURNING user_account.id`,
      [orgId, userId, passwordHash, usadoEm.toISOString()],
    );
    if (usuarioAtualizado.rowCount !== 1) return false;

    await client.query(
      `UPDATE password_reset_tokens
          SET used_at = $3
        WHERE organization_id = $1
          AND user_id = $2
          AND used_at IS NULL`,
      [orgId, userId, usadoEm.toISOString()],
    );
    return true;
  });
}
