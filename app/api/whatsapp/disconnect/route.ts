import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { destroyWhatsappClient, getWhatsappState } from "@/lib/whatsapp-client";
import { logger } from "@/lib/logger";

export async function POST() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = await requireMenuPermission(auth.session, "painel", "update");
  if (denied) return denied;

  try {
    // Desligamento completo: desparelha o aparelho e apaga a sessão persistida,
    // para que o próximo "Gerar QR" permita conectar um número diferente.
    await destroyWhatsappClient({ logout: true });
  } catch (error) {
    logger.error({ err: error }, "Failed to fully disconnect WhatsApp session");
    return NextResponse.json(
      {
        error:
          "Não foi possível limpar a sessão do WhatsApp. Tente novamente antes de gerar um novo QR.",
        provider: process.env.WHATSAPP_PROVIDER || "twilio",
        state: getWhatsappState(),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    provider: process.env.WHATSAPP_PROVIDER || "twilio",
    state: getWhatsappState(),
  });
}
