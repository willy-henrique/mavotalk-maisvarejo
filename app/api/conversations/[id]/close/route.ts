import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import {
  createAuditLog,
  getContactInboundPolicy,
  getConversation,
  updateTicketByConversation,
} from "@/lib/repo";
import { closeConversationSchema } from "@/lib/schemas";
import { emitRealtime } from "@/lib/realtime";
import { logger } from "@/lib/logger";
import { TicketService } from "@/lib/services";
import { sendWhatsappMessage } from "@/lib/whatsapp-client";
import { sendWillTalkWebhook } from "@/lib/willtalk-webhook";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "inbox", "update");
  if (denied) return denied;

  const body = await request.json();
  const parsed = closeConversationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Motivo invalido" }, { status: 400 });
  }

  const { id } = await context.params;
  const existing = await getConversation(auth.session.organizationId, id);
  if (!existing) {
    return NextResponse.json({ error: "Conversa nao encontrada" }, { status: 404 });
  }

  await TicketService.close(auth.session.organizationId, id, parsed.data.reason);

  await createAuditLog(auth.session.organizationId, auth.session.userId, "close_ticket", "conversation", id, {
    reason: parsed.data.reason,
  });

  emitRealtime(auth.session.organizationId, "conversation.updated", { id, status: "encerrado", closeReason: parsed.data.reason });
  void sendWillTalkWebhook({
    event: "ticket_updated",
    organizationId: auth.session.organizationId,
    conversationId: id,
    fallback: {
      cliente: "Cliente",
      tecnico: auth.session.name,
      canal: "whatsapp",
      mensagem: `Ticket encerrado. Motivo: ${parsed.data.reason}`,
    },
  });

  // Se solicitar pesquisa de satisfação e tiver número do contato, envia mensagem de nota
  if (parsed.data.sendSurvey && existing.contactPhone) {
    const contactPolicy = await getContactInboundPolicy(
      auth.session.organizationId,
      existing.contactPhone,
    ).catch((error) => {
      // O chamado já foi encerrado. Uma falha ao consultar a preferência não pode
      // transformar a resposta em erro nem arriscar um envio automático indevido.
      logger.error(
        { err: error, organizationId: auth.session.organizationId, conversationId: id },
        "Failed to read contact bot policy before satisfaction survey",
      );
      return { blocked: true, botDisabled: true };
    });
    const provider = process.env.WHATSAPP_PROVIDER || "unofficial";

    const agentName = auth.session.name || "nosso time";
    const surveyText =
      `Seu atendimento com ${agentName} foi finalizado.\n` +
      `De 1 a 5, qual nota você dá para o atendimento? Responda apenas com o número.`;

    if (
      provider === "unofficial" &&
      !contactPolicy.blocked &&
      !contactPolicy.botDisabled
    ) {
      // Carimba antes de enviar: é esse marcador que faz a resposta numérica ser lida
      // como nota em vez de cair na triagem e reabrir o bot. Se o envio falhar, o
      // carimbo apenas expira sozinho pela janela.
      await updateTicketByConversation(auth.session.organizationId, id, {
        satisfactionSurveySentAt: new Date(),
      });
      // Envio em background: não bloquear a finalização do chamado caso o WhatsApp esteja offline.
      // fromBot: true evita que processOutboundMessageFromDevice reabra a conversa encerrada.
      void sendWhatsappMessage(existing.contactPhone, surveyText, { skipRateLimit: true, fromBot: true }).catch((err) => {
        console.error("Failed to send survey message (unofficial WhatsApp)", err);
      });
    }
    // Se provider != unofficial, não envia nada por enquanto (não estamos usando Twilio)
  }

  return NextResponse.json({ conversation: { id, status: "encerrado" } });
}
