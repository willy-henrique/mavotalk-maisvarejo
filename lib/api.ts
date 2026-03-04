import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    return {
      error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }),
      session: null,
    };
  }

  return { error: null, session };
}

export function requireRole(role: Array<"admin" | "gestor" | "atendente">, currentRole: "admin" | "gestor" | "atendente") {
  if (!role.includes(currentRole)) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  return null;
}

