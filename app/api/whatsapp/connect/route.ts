import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { initWhatsappClient } from "@/lib/whatsapp-client";

export async function POST() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = await requireMenuPermission(auth.session, "painel", "update");
  if (denied) return denied;

  const state = await initWhatsappClient();

  return NextResponse.json({
    provider: process.env.WHATSAPP_PROVIDER || "twilio",
    state,
  });
}
