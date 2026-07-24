import { NextResponse } from "next/server";
import twilio from "twilio";
import { requireSession } from "@/lib/api";
import {
  addOutboundMessage,
  getConversation,
  getContactById,
} from "@/lib/repo";
import { sendMessageSchema } from "@/lib/schemas";
import { emitRealtime } from "@/lib/realtime";
import { sendWhatsappMessage } from "@/lib/whatsapp-client";
import {
  buildQuickReplyContext,
  replaceVariables,
} from "@/lib/quick-reply-service";
import { sendWillTalkWebhook } from "@/lib/willtalk-webhook";
import { logger } from "@/lib/logger";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const { id } = await context.params;
  const body = await request.json();
  const parsed = sendMessageSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Mensagem invalida" }, { status: 400 });
  }

  const conversation = await getConversation(auth.session.organizationId, id);
  if (!conversation) {
    return NextResponse.json({ error: "Conversa nao encontrada" }, { status: 404 });
  }

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_WHATSAPP_NUMBER;
  const provider = process.env.WHATSAPP_PROVIDER || "twilio";

  let externalId: string | undefined;

  if (!conversation.contactPhone) {
    return NextResponse.json({ error: "Numero do contato nao disponivel" }, { status: 400 });
  }

  const contact = await getContactById(auth.session.organizationId, conversation.contactId);
  if (contact?.blocked) {
    return NextResponse.json({ error: "Contato bloqueado para mensagens" }, { status: 409 });
  }
  const ticketNumber = id.slice(0, 8);

  const ctx = buildQuickReplyContext({
    userName: auth.session.name || "Atendente",
    contactName: contact?.name || "Cliente",
    ticketNumber,
  });
  const resolvedContent = replaceVariables(parsed.data.content, ctx);

  const authorId = auth.session.userId;
  const authorName = auth.session.name || "Atendente";
  // Envia para o WhatsApp com a assinatura em linha separada
  const whatsappBody = `${authorName}:\n${resolvedContent}`;

  try {
    if (provider === "unofficial") {
      externalId = await sendWhatsappMessage(conversation.contactPhone, whatsappBody, {
        skipRateLimit: true,
      });
    } else if (twilioSid && twilioToken && twilioFrom) {
      const client = twilio(twilioSid, twilioToken);
      const sent = await client.messages.create({
        from: twilioFrom,
        to: String(conversation.contactPhone),
        body: whatsappBody,
      });
      externalId = sent.sid;
    } else {
      logger.error(
        { provider, organizationId: auth.session.organizationId },
        "Outbound WhatsApp provider is not configured",
      );
      return NextResponse.json(
        { error: "Canal do WhatsApp indisponivel. Contate o administrador." },
        { status: 503 },
      );
    }
  } catch (err) {
    logger.error(
      { err, provider, organizationId: auth.session.organizationId, conversationId: id },
      "Failed to deliver outbound WhatsApp message",
    );
    return NextResponse.json(
      { error: "Nao foi possivel entregar a mensagem no WhatsApp. Tente novamente." },
      { status: 503 },
    );
  }

  const message = await addOutboundMessage(
    auth.session.organizationId,
    id,
    resolvedContent,
    externalId,
    { authorId },
  );

  emitRealtime(auth.session.organizationId, "message.created", { conversationId: id, message });
  emitRealtime(auth.session.organizationId, "conversation.updated", { id, status: "em_atendimento" });
  void sendWillTalkWebhook({
    event: "message_sent",
    organizationId: auth.session.organizationId,
    conversationId: id,
    fallback: {
      cliente: contact?.name || "Cliente",
      canal: "whatsapp",
      tecnico: authorName,
      mensagem: resolvedContent,
    },
  });
  void sendWillTalkWebhook({
    event: "ticket_updated",
    organizationId: auth.session.organizationId,
    conversationId: id,
    fallback: {
      cliente: contact?.name || "Cliente",
      canal: "whatsapp",
      tecnico: authorName,
      mensagem: resolvedContent,
    },
  });

  return NextResponse.json({ message }, { status: 201 });
}
