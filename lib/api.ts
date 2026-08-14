import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserById } from "@/lib/repo";
import { hasMenuPermission, type MenuPermissionAction } from "@/lib/menu-settings";

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    // "Não autenticado" aparecia no chat sem dizer o que fazer. Na prática o caso
    // comum é a sessão ter expirado com o painel aberto.
    return {
      error: NextResponse.json(
        { error: "Sua sessão expirou. Entre novamente para continuar." },
        { status: 401 },
      ),
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

/**
 * Autorização por recurso aplicada no servidor. A sessão é a única fonte do
 * tenant e do papel; o cliente não envia nem organização nem permissões.
 */
export async function requireMenuPermission(
  session: NonNullable<Awaited<ReturnType<typeof requireSession>>["session"]>,
  itemId: string,
  action: MenuPermissionAction,
) {
  const allowed = await hasMenuPermission(session.organizationId, session.role, itemId, action);
  return allowed ? null : NextResponse.json({ error: "Sem permissão" }, { status: 403 });
}

