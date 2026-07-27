import { NextResponse } from "next/server";
import { requireMavoMaster } from "@/lib/mavo-master-api";
import { applySupermarketQueuePreset } from "@/lib/supermarket-setup";
import { resolveMavoOrganization } from "@/lib/mavo-organization-scope";

export async function POST(request: Request) {
  const auth = await requireMavoMaster();
  if (auth.error || !auth.session) return auth.error;

  const organization = await resolveMavoOrganization(
    new URL(request.url).searchParams.get("organizationId"),
  );
  if (!organization) {
    return NextResponse.json({ error: "Organização não encontrada." }, { status: 404 });
  }
  const result = await applySupermarketQueuePreset(organization.id, null);
  return NextResponse.json({
    ok: true,
    created: result.created,
    updated: result.updated,
    paused: result.paused,
  });
}
