import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/api";
import { destroyWhatsappClient, getWhatsappState } from "@/lib/whatsapp-client";

export async function POST() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = requireRole(["admin", "gestor"], auth.session.role);
  if (denied) return denied;

  await destroyWhatsappClient();

  return NextResponse.json({
    provider: process.env.WHATSAPP_PROVIDER || "twilio",
    state: getWhatsappState(),
  });
}
