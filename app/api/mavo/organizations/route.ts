import { NextResponse } from "next/server";
import { requireMavoMaster } from "@/lib/mavo-master-api";
import { listMavoOrganizations } from "@/lib/mavo-organization-scope";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireMavoMaster();
  if (auth.error || !auth.session) return auth.error;
  const organizations = await listMavoOrganizations();
  return NextResponse.json(
    { organizations },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
