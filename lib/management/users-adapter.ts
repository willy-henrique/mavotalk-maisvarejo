import { randomUUID } from "node:crypto";
import {
  queryTenantDatabase,
  requireTenantOrganizationId,
  withTenantTransaction,
} from "@/lib/db";

export type PapelUsuarioGerenciado = "admin" | "gestor" | "atendente";

export type UsuarioGerenciado = {
  id: string;
  name: string;
  email: string;
  role: PapelUsuarioGerenciado;
  isActive: boolean;
  recoveryPhone: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type CriarUsuarioGerenciado = {
  name: string;
  email: string;
  role: PapelUsuarioGerenciado;
  recoveryPhone: string | null;
  senhaProtegida: string;
};

export type AlterarUsuarioGerenciado = Partial<{
  name: string;
  email: string;
  role: PapelUsuarioGerenciado;
  isActive: boolean;
  recoveryPhone: string | null;
  senhaProtegida: string;
}>;

type LinhaUsuario = {
  id: unknown;
  name: unknown;
  email: unknown;
  role: unknown;
  is_active: unknown;
  recovery_phone: unknown;
  created_at: unknown;
  updated_at: unknown;
  last_login_at: unknown;
};

export class UserManagementError extends Error {
  constructor(
    public readonly code: "not_found" | "conflict" | "invalid_request",
    message: string,
  ) {
    super(message);
    this.name = "UserManagementError";
  }
}

const SQL_LISTAR = `
  SELECT id, name, email, role, is_active, recovery_phone,
         created_at, updated_at, last_login_at
  FROM users
  WHERE organization_id = $1
  ORDER BY is_active DESC, name, id
`;

function dataIso(valor: unknown, campo: string): string {
  const data = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(data.getTime())) throw new Error(`${campo} inválida`);
  return data.toISOString();
}

function mapearUsuario(linha: LinhaUsuario): UsuarioGerenciado {
  const role = String(linha.role);
  if (role !== "admin" && role !== "gestor" && role !== "atendente") {
    throw new Error("Papel de usuário inválido");
  }
  const recoveryPhone = String(linha.recovery_phone ?? "").trim() || null;
  if (recoveryPhone && !/^[0-9]{10,15}$/.test(recoveryPhone)) {
    throw new Error("Telefone de recuperação inválido");
  }
  const id = String(linha.id ?? "").trim();
  const name = String(linha.name ?? "").trim();
  const email = String(linha.email ?? "").trim();
  if (!id || !name || !email) throw new Error("Usuário gerenciado inválido");
  return {
    id,
    name,
    email,
    role,
    isActive: linha.is_active === true,
    recoveryPhone,
    createdAt: dataIso(linha.created_at, "Criação"),
    updatedAt: dataIso(linha.updated_at, "Atualização"),
    lastLoginAt: linha.last_login_at ? dataIso(linha.last_login_at, "Último acesso") : null,
  };
}

function postgresCode(erro: unknown): string {
  return String((erro as { code?: unknown })?.code ?? "");
}

function postgresMessage(erro: unknown): string {
  return String((erro as { message?: unknown })?.message ?? "");
}

function traduzirErroBanco(erro: unknown): never {
  if (postgresCode(erro) === "23505") {
    throw new UserManagementError("conflict", "Este e-mail não está disponível");
  }
  if (postgresMessage(erro).includes("last_active_admin")) {
    throw new UserManagementError(
      "conflict",
      "A empresa precisa manter ao menos um administrador ativo",
    );
  }
  throw erro;
}

async function auditar(
  client: { query: (sql: string, values: readonly unknown[]) => Promise<unknown> },
  organizationId: string,
  actorId: string,
  action: string,
  targetId: string,
  fields: string[],
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
       id, organization_id, user_id, action, entity_type, entity_id, metadata
     )
     SELECT $3, actor.organization_id, actor.id, $4, 'user', $5, $6::jsonb
       FROM users actor
      WHERE actor.organization_id = $1
        AND actor.id = $2
        AND actor.role = 'admin'
        AND actor.is_active = true`,
    [organizationId, actorId, randomUUID(), action, targetId, JSON.stringify({ fields })],
  );
}

export async function listarUsuariosGerenciados(
  organizationId: string,
): Promise<UsuarioGerenciado[]> {
  const orgId = requireTenantOrganizationId(organizationId);
  const resultado = await queryTenantDatabase<LinhaUsuario>(orgId, SQL_LISTAR, [orgId]);
  return resultado.rows.map(mapearUsuario);
}

export async function criarUsuarioGerenciado(
  organizationId: string,
  actorId: string,
  entrada: CriarUsuarioGerenciado,
): Promise<UsuarioGerenciado> {
  const orgId = requireTenantOrganizationId(organizationId);
  const id = randomUUID();
  const recoveryPhone = entrada.role === "atendente" ? null : entrada.recoveryPhone;
  if (entrada.role !== "atendente" && !recoveryPhone) {
    throw new UserManagementError(
      "invalid_request",
      "Administrador e gestor precisam de WhatsApp de recuperação",
    );
  }

  try {
    return await withTenantTransaction(orgId, async (client) => {
      const resultado = await client.query<LinhaUsuario>(
        `INSERT INTO users (
           id, organization_id, name, email, password_hash, role,
           is_active, recovery_phone, created_at, updated_at
         )
         SELECT $3, actor.organization_id, $4, $5, $6, $7, true, $8, now(), now()
           FROM users actor
          WHERE actor.organization_id = $1
            AND actor.id = $2
            AND actor.role = 'admin'
            AND actor.is_active = true
         RETURNING id, name, email, role, is_active, recovery_phone,
                   created_at, updated_at, last_login_at`,
        [
          orgId,
          actorId,
          id,
          entrada.name,
          entrada.email.toLowerCase(),
          entrada.senhaProtegida,
          entrada.role,
          recoveryPhone,
        ],
      );
      const linha = resultado.rows[0];
      if (!linha) throw new UserManagementError("invalid_request", "Administrador inválido");
      await auditar(client, orgId, actorId, "create_user", id, [
        "name",
        "email",
        "role",
        "recoveryPhone",
      ]);
      return mapearUsuario(linha);
    });
  } catch (erro) {
    if (erro instanceof UserManagementError) throw erro;
    return traduzirErroBanco(erro);
  }
}

export async function atualizarUsuarioGerenciado(
  organizationId: string,
  actorId: string,
  userId: string,
  entrada: AlterarUsuarioGerenciado,
): Promise<UsuarioGerenciado> {
  const orgId = requireTenantOrganizationId(organizationId);
  const targetId = String(userId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(targetId)) {
    throw new UserManagementError("not_found", "Usuário não encontrado");
  }
  if (Object.keys(entrada).length === 0) {
    throw new UserManagementError("invalid_request", "Nenhuma alteração informada");
  }

  try {
    return await withTenantTransaction(orgId, async (client) => {
      const atual = await client.query<LinhaUsuario>(
        `SELECT id, name, email, role, is_active, recovery_phone,
                created_at, updated_at, last_login_at
           FROM users
          WHERE organization_id = $1
            AND id = $2
          FOR UPDATE`,
        [orgId, targetId],
      );
      const linhaAtual = atual.rows[0];
      if (!linhaAtual) throw new UserManagementError("not_found", "Usuário não encontrado");

      const papelFinal = entrada.role ?? String(linhaAtual.role) as PapelUsuarioGerenciado;
      const ativoFinal = entrada.isActive ?? linhaAtual.is_active === true;
      const telefoneFinal = Object.hasOwn(entrada, "recoveryPhone")
        ? entrada.recoveryPhone ?? null
        : String(linhaAtual.recovery_phone ?? "").trim() || null;
      if (targetId === actorId && (papelFinal !== "admin" || !ativoFinal)) {
        throw new UserManagementError(
          "invalid_request",
          "Não é permitido remover o acesso da própria conta administrativa",
        );
      }
      if (papelFinal !== "atendente" && !telefoneFinal) {
        throw new UserManagementError(
          "invalid_request",
          "Administrador e gestor precisam de WhatsApp de recuperação",
        );
      }

      const valores: unknown[] = [orgId, targetId];
      const campos: string[] = [];
      const adicionar = (coluna: string, valor: unknown) => {
        valores.push(valor);
        campos.push(`${coluna} = $${valores.length}`);
      };
      if (entrada.name !== undefined) adicionar("name", entrada.name);
      if (entrada.email !== undefined) adicionar("email", entrada.email.toLowerCase());
      if (entrada.role !== undefined) adicionar("role", entrada.role);
      if (entrada.isActive !== undefined) adicionar("is_active", entrada.isActive);
      if (Object.hasOwn(entrada, "recoveryPhone")) {
        adicionar("recovery_phone", papelFinal === "atendente" ? null : telefoneFinal);
      }
      if (entrada.senhaProtegida !== undefined) adicionar("password_hash", entrada.senhaProtegida);
      campos.push("updated_at = now()");

      const alterado = await client.query<LinhaUsuario>(
        `UPDATE users AS user_account
            SET ${campos.join(", ")}
          WHERE user_account.organization_id = $1
            AND user_account.id = $2
        RETURNING id, name, email, role, is_active, recovery_phone,
                  created_at, updated_at, last_login_at`,
        valores,
      );
      const linhaAlterada = alterado.rows[0];
      if (!linhaAlterada) throw new UserManagementError("not_found", "Usuário não encontrado");

      await client.query(
        `UPDATE password_reset_tokens
            SET used_at = now()
          WHERE organization_id = $1
            AND user_id = $2
            AND used_at IS NULL`,
        [orgId, targetId],
      );
      await auditar(client, orgId, actorId, "update_user", targetId, Object.keys(entrada));
      return mapearUsuario(linhaAlterada);
    });
  } catch (erro) {
    if (erro instanceof UserManagementError) throw erro;
    return traduzirErroBanco(erro);
  }
}

export async function desativarUsuarioGerenciado(
  organizationId: string,
  actorId: string,
  userId: string,
): Promise<UsuarioGerenciado> {
  return atualizarUsuarioGerenciado(organizationId, actorId, userId, { isActive: false });
}
