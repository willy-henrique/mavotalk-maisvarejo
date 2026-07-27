import { NextResponse } from "next/server";
import { requireMavoMaster } from "@/lib/mavo-master-api";
import { getMavoSystemOverview } from "@/lib/mavo-system-overview";
import { resolveMavoOrganization } from "@/lib/mavo-organization-scope";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireMavoMaster();
  if (auth.error || !auth.session) return auth.error;
  const organization = await resolveMavoOrganization(
    new URL(request.url).searchParams.get("organizationId"),
  );
  if (!organization) {
    return NextResponse.json({ error: "Organização não encontrada." }, { status: 404 });
  }
  const overview = await getMavoSystemOverview(organization.id);
  return NextResponse.json(
    { overview },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
