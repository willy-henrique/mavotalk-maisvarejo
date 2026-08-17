import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import {
  addOutboundMessage,
  assignConversation,
  createAuditLog,
  getOrCreateContactAndOpenConversation,
  isContactBlocked,
  listConversations,
  updateConversationById,
  type ConversationStatus,
} from "@/lib/repo";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { startConversationSchema } from "@/lib/schemas";
import { emitRealtime } from "@/lib/realtime";
import { getSupermarketSettings } from "@/lib/supermarket-settings";
import {
  resolveWhatsappDestination,
  sendWhatsappMessage,
} from "@/lib/whatsapp-client";
import { logger } from "@/lib/logger";
import { requestIdFrom } from "@/lib/observability";

const allowedStatus = new Set<ConversationStatus>(["aguardando", "em_atendimento", "pendente_cliente", "encerrado"]);

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "inbox", "read");
  if (denied) return denied;

  const statusParam = request.nextUrl.searchParams.get("status");
  const status = statusParam && allowedStatus.has(statusParam as ConversationStatus) ? (statusParam as ConversationStatus) : undefined;

  try {
    const conversations = await listConversations(auth.session.organizationId, status);
    return NextResponse.json({ conversations });
  } catch (error) {
    logger.error({ err: error, organizationId: auth.session.organizationId }, "Failed to list conversations");
    throw error;
  }
}

/**
 * Inicia uma conversa com um número que nunca escreveu.
 *
 * A lista de contatos só tem quem já interagiu, então sem isto não havia como a loja
 * dar o primeiro passo — só responder.
 */
export async function POST(request: NextRequest) {
  const requestId = requestIdFrom(request);
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "inbox", "update");
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = startConversationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Dados inválidos" },
      { status: 422 },
    );
  }

  const { phone: inputPhone, message, contactName } = parsed.data;
  const organizationId = auth.session.organizationId;

  logger.info(
    { requestId, organizationId, stage: "createConversation" },
    "Starting active WhatsApp conversation",
  );

  const destination = await resolveWhatsappDestination(inputPhone);
  if (!("phone" in destination)) {
    if (destination.status === "unavailable") {
      return NextResponse.json(
        {
          error: "O WhatsApp conectado não está pronto para validar e enviar. Tente novamente em instantes.",
          code: "WHATSAPP_UNAVAILABLE",
          requestId,
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        error:
          destination.status === "invalid"
            ? "Número inválido. Informe DDD + número ou DDI + DDD + número."
            : "Este número não foi encontrado no WhatsApp. Confira o DDI, o DDD e o nono dígito.",
        code:
          destination.status === "invalid"
            ? "INVALID_PHONE"
            : "WHATSAPP_NUMBER_NOT_FOUND",
        requestId,
      },
      { status: 422 },
    );
  }

  const phone = destination.phone;
  if (await isContactBlocked(organizationId, phone)) {
    return NextResponse.json(
      {
        error: "Este contato está bloqueado. Desbloqueie antes de iniciar a conversa.",
        code: "CONTACT_BLOCKED",
        requestId,
      },
      { status: 409 },
    );
  }

  const { contact, conversation } = await getOrCreateContactAndOpenConversation(
    organizationId,
    phone,
    contactName?.trim() || "Contato",
  );

  // Conversa iniciada por uma pessoa não passa por triagem: sem isto a resposta do
  // cliente cairia no bot e ele receberia o menu de boas-vindas.
  await updateConversationById(organizationId, String(conversation.id), {
    triageCompleted: true,
  });
  await assignConversation(organizationId, String(conversation.id), auth.session.userId);

  const { agentSignatureEnabled } = await getSupermarketSettings(organizationId);
  const authorName = auth.session.name || "Atendente";
  const outboundBody = agentSignatureEnabled ? `${authorName}:\n${message}` : message;

  let externalId: string | undefined;
  try {
    const provider = process.env.WHATSAPP_PROVIDER || "twilio";
    logger.info(
      {
        requestId,
        organizationId,
        conversationId: conversation.id,
        stage: "sendMessageToGateway",
        provider,
        destinationCorrected: destination.corrected,
      },
      "Sending first active-conversation message",
    );
    if (provider === "unofficial") {
      externalId = await sendWhatsappMessage(phone, outboundBody, {
        skipRateLimit: true,
        destinationJid: destination.jid,
      });
    } else {
      const twilioSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioToken = process.env.TWILIO_AUTH_TOKEN;
      const twilioFrom = process.env.TWILIO_WHATSAPP_NUMBER;
      if (!twilioSid || !twilioToken || !twilioFrom) {
        throw new Error("Outbound WhatsApp provider is not configured");
      }
      const client = twilio(twilioSid, twilioToken);
      const sent = await client.messages.create({
        from: twilioFrom,
        to: phone,
        body: outboundBody,
      });
      externalId = sent.sid;
    }
  } catch (error) {
    logger.error(
      {
        err: error,
        requestId,
        organizationId,
        conversationId: conversation.id,
        stage: "sendMessageToGateway",
      },
      "Failed to start conversation on WhatsApp",
    );
    // A conversa fica criada e atribuída, mas sem mensagem entregue seria enganoso
    // reportar sucesso: o atendente precisa saber que o cliente não recebeu nada.
    return NextResponse.json(
      {
        error: "O WhatsApp recusou ou não confirmou o envio. A mensagem não foi registrada como entregue; tente novamente.",
        code: "WHATSAPP_SEND_FAILED",
        requestId,
        conversation: { id: conversation.id },
      },
      { status: 502 },
    );
  }

  const persisted = await addOutboundMessage(
    organizationId,
    String(conversation.id),
    message,
    externalId,
    { authorId: auth.session.userId },
  );

  await createAuditLog(
    organizationId,
    auth.session.userId,
    "start_conversation",
    "conversation",
    String(conversation.id),
    {
      verifiedOnWhatsapp: destination.status === "verified",
      destinationCorrected: destination.corrected,
      candidatesChecked: destination.candidatesChecked,
      gatewayMessageId: externalId,
      requestId,
    },
  );

  logger.info(
    {
      requestId,
      organizationId,
      conversationId: conversation.id,
      stage: "updateStatusLocal",
      gatewayConfirmed: Boolean(externalId),
    },
    "Active WhatsApp conversation started",
  );

  emitRealtime(organizationId, "message.created", {
    conversationId: conversation.id,
    message: persisted,
  });
  emitRealtime(organizationId, "conversation.created", {
    id: conversation.id,
    status: "em_atendimento",
  });

  return NextResponse.json({
    conversation: { id: conversation.id, status: "em_atendimento" },
    contact: { id: contact.id, name: contact.name, phoneNumber: phone },
  });
}
