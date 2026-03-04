import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireRole, requireSession } from "@/lib/api";
import { createAuditLog, createUser, listUsers } from "@/lib/repo";
import { adminCreateUserSchema } from "@/lib/schemas";

function toPublicUser(user: {
  id: string;
  name: string;
  email: string;
  role: "admin" | "gestor" | "atendente";
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = requireRole(["admin", "gestor"], auth.session.role);
  if (denied) return denied;

  const users = await listUsers(auth.session.organizationId);
  return NextResponse.json({
    users: users.filter((user) => user.isActive !== false).map((user) => toPublicUser(user)),
  });
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = requireRole(["admin", "gestor"], auth.session.role);
  if (denied) return denied;

  const body = await request.json();
  const parsed = adminCreateUserSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const result = await createUser(auth.session.organizationId, {
    name: parsed.data.name,
    email: parsed.data.email,
    passwordHash,
    role: parsed.data.role,
    isActive: true,
  });

  if (result.error === "EMAIL_EXISTS") {
    return NextResponse.json({ error: "Email ja cadastrado" }, { status: 409 });
  }

  if (!result.user) {
    return NextResponse.json({ error: "Falha ao criar usuario" }, { status: 500 });
  }

  await createAuditLog(auth.session.organizationId, auth.session.userId, "create_user", "user", result.user.id, {
    email: result.user.email,
    role: result.user.role,
  });

  return NextResponse.json({ user: toPublicUser(result.user) }, { status: 201 });
}
