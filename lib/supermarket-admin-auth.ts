import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { getMavoMasterSession } from "@/lib/mavo-master-auth";
import { resolveMavoOrganization } from "@/lib/mavo-organization-scope";

export async function requireSupermarketAdmin(request?: Request) {
  const appAuth = await requireSession();
  if (appAuth.session) {
    if (appAuth.session.role !== "admin" && appAuth.session.role !== "gestor") {
      return { error: NextResponse.json({ error: "Sem permissão" }, { status: 403 }), session: null };
    }
    return { error: null, session: appAuth.session };
  }

  const master = await getMavoMasterSession();
  if (!master) return { error: appAuth.error || NextResponse.json({ error: "Não autenticado" }, { status: 401 }), session: null };
  const organization = await resolveMavoOrganization(
    request?.headers.get("x-mavo-organization-id"),
  );
  if (!organization) {
    return { error: NextResponse.json({ error: "Organização não encontrada." }, { status: 404 }), session: null };
  }
  return {
    error: null,
    session: {
      organizationId: organization.id,
      userId: null,
      role: "admin" as const,
      name: master.name,
      email: master.email,
    },
  };
}
