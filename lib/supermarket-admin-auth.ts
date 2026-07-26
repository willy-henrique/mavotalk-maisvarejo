import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { getMavoMasterSession } from "@/lib/mavo-master-auth";

export async function requireSupermarketAdmin() {
  const appAuth = await requireSession();
  if (appAuth.session) {
    if (appAuth.session.role !== "admin" && appAuth.session.role !== "gestor") {
      return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }), session: null };
    }
    return { error: null, session: appAuth.session };
  }

  const master = await getMavoMasterSession();
  if (!master) return { error: appAuth.error || NextResponse.json({ error: "Não autenticado" }, { status: 401 }), session: null };
  return {
    error: null,
    session: {
      organizationId: String(process.env.DEFAULT_ORG_ID || "org_willtalk_default"),
      userId: null,
      role: "admin" as const,
      name: master.name,
      email: master.email,
    },
  };
}
