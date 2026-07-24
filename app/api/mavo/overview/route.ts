import { NextResponse } from "next/server";
import { requireMavoMaster } from "@/lib/mavo-master-api";
import { getMavoSystemOverview } from "@/lib/mavo-system-overview";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireMavoMaster();
  if (auth.error || !auth.session) return auth.error;
  const overview = await getMavoSystemOverview();
  return NextResponse.json(
    { overview },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
