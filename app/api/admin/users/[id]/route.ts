import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireRole, requireSession } from "@/lib/api";
import { createAuditLog, deactivateUser, listUsers, updateUser } from "@/lib/repo";
import { adminUpdateUserSchema } from "@/lib/schemas";

function toPublicUser(user: {
  id: string;
  name: string;
  email: string;
  role: "admin" | "gestor" | "atendente";
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    lastLoginAt: user.lastLoginAt || null,
  };
}

function isLastAdminConstraint(error: unknown): boolean {
  return String((error as { message?: unknown })?.message || error).includes(
    "last_active_admin",
  );
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = requireRole(["admin"], auth.session.role);
  if (denied) return denied;

  const { id } = await context.params;
  const body = await request.json();
  const parsed = adminUpdateUserSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", details: parsed.error.flatten() }, { status: 400 });
  }

  if (
    id === auth.session.userId &&
    ((parsed.data.role && parsed.data.role !== "admin") || parsed.data.isActive === false)
  ) {
    return NextResponse.json(
      { error: "Nao e permitido remover seu proprio acesso administrativo" },
      { status: 400 },
    );
  }

  if ((parsed.data.role && parsed.data.role !== "admin") || parsed.data.isActive === false) {
    const activeAdmins = (await listUsers(auth.session.organizationId)).filter(
      (user) => user.role === "admin" && user.isActive !== false,
    );
    if (activeAdmins.length === 1 && activeAdmins[0]?.id === id) {
      return NextResponse.json(
        { error: "A organizacao deve manter ao menos um administrador ativo" },
        { status: 409 },
      );
    }
  }

  const updates: Partial<{
    name: string;
    email: string;
    passwordHash: string;
    role: "admin" | "gestor" | "atendente";
    isActive: boolean;
  }> = {
    name: parsed.data.name,
    email: parsed.data.email,
    role: parsed.data.role,
    isActive: parsed.data.isActive,
  };

  if (parsed.data.password) {
    updates.passwordHash = await bcrypt.hash(parsed.data.password, 10);
  }

  let result: Awaited<ReturnType<typeof updateUser>>;
  try {
    result = await updateUser(auth.session.organizationId, id, updates);
  } catch (error) {
    if (isLastAdminConstraint(error)) {
      return NextResponse.json(
        { error: "A organizacao deve manter ao menos um administrador ativo" },
        { status: 409 },
      );
    }
    throw error;
  }

  if (result.error === "NOT_FOUND") {
    return NextResponse.json({ error: "Usuario nao encontrado" }, { status: 404 });
  }

  if (result.error === "EMAIL_EXISTS") {
    return NextResponse.json({ error: "Email ja cadastrado" }, { status: 409 });
  }

  if (!result.user) {
    return NextResponse.json({ error: "Falha ao atualizar usuario" }, { status: 500 });
  }

  await createAuditLog(auth.session.organizationId, auth.session.userId, "update_user", "user", id, {
    fields: Object.keys(parsed.data),
  });

  return NextResponse.json({ user: toPublicUser(result.user) });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = requireRole(["admin"], auth.session.role);
  if (denied) return denied;

  const { id } = await context.params;

  if (id === auth.session.userId) {
    return NextResponse.json({ error: "Nao e permitido remover sua propria conta" }, { status: 400 });
  }

  const activeAdmins = (await listUsers(auth.session.organizationId)).filter(
    (user) => user.role === "admin" && user.isActive !== false,
  );
  if (activeAdmins.length === 1 && activeAdmins[0]?.id === id) {
    return NextResponse.json(
      { error: "A organizacao deve manter ao menos um administrador ativo" },
      { status: 409 },
    );
  }

  let result: Awaited<ReturnType<typeof deactivateUser>>;
  try {
    result = await deactivateUser(auth.session.organizationId, id);
  } catch (error) {
    if (isLastAdminConstraint(error)) {
      return NextResponse.json(
        { error: "A organizacao deve manter ao menos um administrador ativo" },
        { status: 409 },
      );
    }
    throw error;
  }

  if (result.error === "NOT_FOUND") {
    return NextResponse.json({ error: "Usuario nao encontrado" }, { status: 404 });
  }

  if (!result.user) {
    return NextResponse.json({ error: "Falha ao remover usuario" }, { status: 500 });
  }

  await createAuditLog(auth.session.organizationId, auth.session.userId, "deactivate_user", "user", id);

  return NextResponse.json({ ok: true, user: toPublicUser(result.user) });
}
