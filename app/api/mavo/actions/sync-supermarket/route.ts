import { NextResponse } from "next/server";
import { requireMavoMaster } from "@/lib/mavo-master-api";
import { applySupermarketQueuePreset } from "@/lib/supermarket-setup";

export async function POST() {
  const auth = await requireMavoMaster();
  if (auth.error || !auth.session) return auth.error;

  const organizationId = String(process.env.DEFAULT_ORG_ID || "org_willtalk_default");
  const result = await applySupermarketQueuePreset(organizationId, null);
  return NextResponse.json({
    ok: true,
    created: result.created,
    updated: result.updated,
    paused: result.paused,
  });
}
