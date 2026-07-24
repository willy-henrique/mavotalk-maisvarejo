import { NextResponse } from "next/server";
import { clearMavoMasterCookie } from "@/lib/mavo-master-auth";

export async function POST() {
  await clearMavoMasterCookie();
  return NextResponse.json({ ok: true });
}
