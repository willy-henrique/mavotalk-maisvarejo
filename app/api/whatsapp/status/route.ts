import { NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/api";
import { getWhatsappState } from "@/lib/whatsapp-client";

export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = requireRole(["admin", "gestor"], auth.session.role);
  if (denied) return denied;

  return NextResponse.json({
    provider: process.env.WHATSAPP_PROVIDER || "twilio",
    state: getWhatsappState(),
  });
}
