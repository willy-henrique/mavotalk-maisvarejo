import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { getWhatsappState, requestWhatsappPairingCode } from "@/lib/whatsapp-client";
import { logger } from "@/lib/logger";

export async function POST(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = await requireMenuPermission(auth.session, "painel", "update");
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { phone?: unknown };
  const phone = String(body.phone || "").trim();
  if (!phone) {
    return NextResponse.json(
      { error: "Informe o número de telefone com DDI e DDD." },
      { status: 400 },
    );
  }

  try {
    const pairing = await requestWhatsappPairingCode(phone);
    return NextResponse.json({
      provider: process.env.WHATSAPP_PROVIDER || "twilio",
      pairing,
      state: getWhatsappState(),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Não foi possível gerar o código de pareamento.";
    logger.warn({ err: error }, "Failed to issue WhatsApp pairing code");
    // Falhas aqui são de pré-condição (número inválido, sessão ainda conectada)
    // ou indisponibilidade momentânea — o painel mostra a mensagem ao operador.
    return NextResponse.json(
      { error: message, state: getWhatsappState() },
      { status: 422 },
    );
  }
}
