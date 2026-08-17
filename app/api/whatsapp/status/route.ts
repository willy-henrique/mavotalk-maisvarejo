import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import {
  getWhatsappMessageSyncDiagnostics,
  getWhatsappState,
} from "@/lib/whatsapp-client";

export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "painel", "read");
  if (denied) return denied;

  return NextResponse.json({
    provider: process.env.WHATSAPP_PROVIDER || "twilio",
    state: getWhatsappState(),
    messageSync: getWhatsappMessageSyncDiagnostics(),
  });
}
