import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { metricsError } from "@/lib/metrics/envelope";
import { requireMetricsAccess } from "@/lib/metrics/guard";
import {
  atualizarUsuarioGerenciado,
  desativarUsuarioGerenciado,
  UserManagementError,
  type AlterarUsuarioGerenciado,
} from "@/lib/management/users-adapter";

export const dynamic = "force-dynamic";

const telefone = z
  .string()
  .trim()
  .max(30)
  .transform((valor) => valor.replace(/\D/g, ""))
  .refine((valor) => /^[0-9]{10,15}$/.test(valor), "WhatsApp inválido");

const alterarSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().email().max(254).optional(),
    password: z.string().min(10).max(128).optional(),
    role: z.enum(["admin", "gestor", "atendente"]).optional(),
    isActive: z.boolean().optional(),
    recoveryPhone: telefone.nullable().optional(),
  })
  .strict()
  .refine((dados) => Object.keys(dados).length > 0, "Nenhuma alteração informada");

function erroGerenciado(erro: UserManagementError) {
  return metricsError(erro.code, erro.message);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const acesso = await requireMetricsAccess(request);
  if (acesso.error) return acesso.error;
  const { session } = acesso;
  if (session.role !== "admin") {
    return metricsError("forbidden", "Somente administradores gerenciam usuários");
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return metricsError("invalid_request", "Dados de usuário inválidos");
  }
  const analisado = alterarSchema.safeParse(corpo);
  if (!analisado.success) {
    return metricsError("invalid_request", "Revise os dados informados");
  }

  try {
    const entrada: AlterarUsuarioGerenciado = {
      name: analisado.data.name,
      email: analisado.data.email,
      role: analisado.data.role,
      isActive: analisado.data.isActive,
    };
    if (Object.hasOwn(analisado.data, "recoveryPhone")) {
      entrada.recoveryPhone = analisado.data.recoveryPhone ?? null;
    }
    if (analisado.data.password) {
      entrada.senhaProtegida = await bcrypt.hash(analisado.data.password, 12);
    }
    for (const chave of Object.keys(entrada) as Array<keyof AlterarUsuarioGerenciado>) {
      if (entrada[chave] === undefined) delete entrada[chave];
    }

    const { id } = await context.params;
    const user = await atualizarUsuarioGerenciado(
      session.organizationId,
      session.userId,
      id,
      entrada,
    );
    return NextResponse.json({ data: { user } });
  } catch (erro) {
    if (erro instanceof UserManagementError) return erroGerenciado(erro);
    return metricsError("internal", "Não foi possível atualizar o usuário");
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const acesso = await requireMetricsAccess(request);
  if (acesso.error) return acesso.error;
  const { session } = acesso;
  if (session.role !== "admin") {
    return metricsError("forbidden", "Somente administradores gerenciam usuários");
  }

  try {
    const { id } = await context.params;
    const user = await desativarUsuarioGerenciado(
      session.organizationId,
      session.userId,
      id,
    );
    return NextResponse.json({ data: { user } });
  } catch (erro) {
    if (erro instanceof UserManagementError) return erroGerenciado(erro);
    return metricsError("internal", "Não foi possível desativar o usuário");
  }
}
