import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/repo";

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    return {
      error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }),
      session: null,
    };
  }

  const currentUser = await getUserById(session.organizationId, session.userId);
  if (!currentUser?.isActive) {
    return {
      error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }),
      session: null,
    };
  }

  return {
    error: null,
    session: {
      ...session,
      organizationId: String(currentUser.organizationId),
      userId: String(currentUser.id),
      role: currentUser.role as "admin" | "gestor" | "atendente",
      name: String(currentUser.name || ""),
      email: String(currentUser.email || ""),
    },
  };
}

export function requireRole(role: Array<"admin" | "gestor" | "atendente">, currentRole: "admin" | "gestor" | "atendente") {
  if (!role.includes(currentRole)) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  return null;
}

