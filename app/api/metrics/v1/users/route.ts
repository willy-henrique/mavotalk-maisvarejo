import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { metricsError } from "@/lib/metrics/envelope";
import { requireMetricsAccess } from "@/lib/metrics/guard";
import {
  criarUsuarioGerenciado,
  listarUsuariosGerenciados,
  UserManagementError,
} from "@/lib/management/users-adapter";

export const dynamic = "force-dynamic";

const telefone = z
  .string()
  .trim()
  .max(30)
  .transform((valor) => valor.replace(/\D/g, ""))
  .refine((valor) => /^[0-9]{10,15}$/.test(valor), "WhatsApp inválido");

const criarSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254),
    password: z.string().min(10).max(128),
    role: z.enum(["admin", "gestor", "atendente"]),
    recoveryPhone: telefone.nullable().optional(),
  })
  .strict()
  .superRefine((dados, contexto) => {
    if (dados.role !== "atendente" && !dados.recoveryPhone) {
      contexto.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recoveryPhone"],
        message: "Informe o WhatsApp de recuperação",
      });
    }
  });

function erroGerenciado(erro: UserManagementError) {
  return metricsError(erro.code, erro.message);
}

export async function GET(request: Request) {
  const acesso = await requireMetricsAccess(request);
  if (acesso.error) return acesso.error;
  const { session } = acesso;
  if (session.role !== "admin") {
    return metricsError("forbidden", "Somente administradores gerenciam usuários");
  }

  try {
    const users = await listarUsuariosGerenciados(session.organizationId);
    return NextResponse.json({
      data: { users },
      meta: { generatedAt: new Date().toISOString() },
    });
  } catch {
    return metricsError("internal", "Não foi possível listar os usuários");
  }
}

export async function POST(request: Request) {
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
  const analisado = criarSchema.safeParse(corpo);
  if (!analisado.success) {
    return metricsError("invalid_request", "Revise os dados e a política de senha");
  }

  try {
    const senhaProtegida = await bcrypt.hash(analisado.data.password, 12);
    const user = await criarUsuarioGerenciado(session.organizationId, session.userId, {
      name: analisado.data.name,
      email: analisado.data.email,
      role: analisado.data.role,
      recoveryPhone: analisado.data.recoveryPhone ?? null,
      senhaProtegida,
    });
    return NextResponse.json({ data: { user } }, { status: 201 });
  } catch (erro) {
    if (erro instanceof UserManagementError) return erroGerenciado(erro);
    return metricsError("internal", "Não foi possível criar o usuário");
  }
}
