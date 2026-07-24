import { NextResponse } from "next/server";
import twilio from "twilio";
import { isOpenBusinessHour } from "@/lib/business-hours";
import { uploadTwilioMediaToCloudinary } from "@/lib/cloudinary";
import {
  addInboundMessage,
  listQueues,
  findMessageByExternalId,
  getOrCreateContactAndOpenConversation,
  resolveOrganizationByChannel,
  updateConversationById,
  updateTicketByConversation,
} from "@/lib/repo";
import { emitRealtime } from "@/lib/realtime";
import { invokeTicketUpsertLocal } from "@/lib/n8n-ticket-upsert-client";
import {
  buildInvestigationAiReply,
  buildQuickGuidance,
  INVESTIGATION_AI_ROUNDS,
} from "@/lib/investigation-reply";
import { buildDemandMenu, normalizePhone } from "@/lib/utils";
import { sendWillTalkWebhook } from "@/lib/willtalk-webhook";
import { routeBusinessWhatsappMessage } from "@/lib/business-access/business-whatsapp-router";
import { requestIdFrom } from "@/lib/observability";

function twimlMessage(body: string) {
  const response = new twilio.twiml.MessagingResponse();
  response.message(body);
  return response.toString();
}

function parseMediaType(contentType?: string | null): "text" | "image" | "document" {
  if (!contentType) return "text";
  if (contentType.startsWith("image/")) return "image";
  return "document";
}

function withXml(body: string) {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

/** Empty TwiML - used to acknowledge status callbacks without sending a message. */
function emptyTwiML() {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  const n8nOnlyMode = String(process.env.WILLTALK_N8N_ONLY || "").toLowerCase() === "true";
  const rawBody = await request.text();
  const params = new URLSearchParams(rawBody);

  const signature = request.headers.get("x-twilio-signature") || "";
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!token && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Webhook Twilio indisponível", requestId },
      { status: 503 },
    );
  }
  if (token) {
    const asObject = Object.fromEntries(params.entries());
    const configuredBase = process.env.TWILIO_WEBHOOK_BASE_URL?.replace(/\/$/, "");
    const validationUrl = configuredBase
      ? `${configuredBase}${new URL(request.url).pathname}`
      : request.url;
    const valid = twilio.validateRequest(token, signature, validationUrl, asObject);
    if (!valid) {
      return NextResponse.json({ error: "Assinatura Twilio invalida" }, { status: 403 });
    }
  }

  const messageStatus = params.get("MessageStatus");
  if (messageStatus) {
    return emptyTwiML();
  }

  const from = normalizePhone(params.get("From") || "");
  const to = normalizePhone(params.get("To") || "");
  const body = (params.get("Body") || "").trim();
  const profileName = params.get("ProfileName") || "Cliente";
  const mediaUrl = params.get("MediaUrl0");
  const mediaType = params.get("MediaContentType0");
  const messageSid = params.get("MessageSid") || undefined;

  if (!from) {
    return NextResponse.json({ error: "Payload invalido" }, { status: 400 });
  }

  if (!body && !mediaUrl) {
    return emptyTwiML();
  }

  const organizationId = await resolveOrganizationByChannel(to || null);

  if (messageSid) {
    try {
      const existing = await findMessageByExternalId(organizationId, messageSid);
      if (existing) return emptyTwiML();
    } catch {
      // Em falha transitória de persistência, segue para não perder a mensagem.
    }
  }

  const businessRouting = await routeBusinessWhatsappMessage({
    organizationId,
    phone: from,
    message: body || (mediaUrl ? "[mídia]" : ""),
    conversationReference: messageSid,
    requestId,
  });
  if (businessRouting.destination === "business") {
    return businessRouting.reply
      ? withXml(twimlMessage(businessRouting.reply))
      : emptyTwiML();
  }

  // Bot-first / Cérebro v3: mesma triagem do não-oficial — delega ao ticket-upsert (sem TwiML de resposta).
  if (n8nOnlyMode) {
    void invokeTicketUpsertLocal({
      event_id: messageSid || `tw-${Date.now()}`,
      canal: "whatsapp",
      organization_id: organizationId,
      cliente: { nome: profileName, telefone: from },
      mensagem: body || "[midia]",
      mediaUrl: mediaUrl || undefined,
      mimeType: mediaType || undefined,
    });
    return emptyTwiML();
  }

  const { contact, conversation } = await getOrCreateContactAndOpenConversation(
    organizationId,
    from,
    profileName,
  );

  let finalMediaUrl: string | null = mediaUrl;
  let cloudinaryPublicId: string | null = null;
  if (mediaUrl) {
    try {
      const uploaded = await uploadTwilioMediaToCloudinary(mediaUrl, mediaType);
      if (uploaded?.secure_url) finalMediaUrl = uploaded.secure_url;
      if (uploaded?.public_id) cloudinaryPublicId = uploaded.public_id;
    } catch {
      // fallback para URL original quando Cloudinary falhar
    }
  }

  const inbound = await addInboundMessage({
    organizationId,
    conversationId: String(conversation.id),
    externalId: messageSid,
    type: parseMediaType(mediaType),
    content: body || "[midia]",
    mediaUrl: finalMediaUrl,
    mimeType: mediaType,
    cloudinaryPublicId,
  });

  emitRealtime(organizationId, "message.created", { conversationId: conversation.id, message: inbound });
  if (conversation.isNew) {
    void sendWillTalkWebhook({
      event: "ticket_created",
      organizationId,
      conversationId: String(conversation.id),
      fallback: {
        cliente: contact.name,
        canal: "whatsapp",
        mensagem: body || "[midia]",
      },
    });
  }
  void sendWillTalkWebhook({
    event: "message_received",
    organizationId,
    conversationId: String(conversation.id),
    fallback: {
      cliente: contact.name,
      canal: "whatsapp",
      mensagem: body || "[midia]",
    },
  });

  const queues = (await listQueues(organizationId)).filter((q) => q.isActive !== false);

  const businessOpen = await isOpenBusinessHour(new Date(), organizationId);
  const outOfHoursSuffix = businessOpen
    ? ""
    : "\n\nEstamos fora do horario comercial no momento. Seu chamado foi registrado e responderemos no proximo expediente.";
  const buildInvestigationPrompt = (queueName?: string | null) => {
    const header = queueName
      ? `Perfeito, recebi sua demanda de *${queueName}*.`
      : "Perfeito, recebi sua demanda.";
    return `${header} Para te ajudar com mais precisão, me envie por favor: 1) print/foto da tela, 2) mensagem de erro exata e 3) se o impacto está total ou parcial.${outOfHoursSuffix}`;
  };

  if (!conversation.triageCompleted) {
    if (conversation.queueId) {
      const currentQueue = queues.find((item) => String(item.id) === String(conversation.queueId));
      const attempts = Number(conversation.menuAttempts || 0);

      if (attempts >= INVESTIGATION_AI_ROUNDS) {
        const quickGuidance = buildQuickGuidance(body);
        await updateConversationById(organizationId, String(conversation.id), {
          triageCompleted: true,
          menuAttempts: attempts + 1,
          status: "aguardando",
        });

        emitRealtime(organizationId, "conversation.updated", {
          id: String(conversation.id),
          queueId: String(conversation.queueId),
          status: "aguardando",
        });
        void sendWillTalkWebhook({
          event: "ticket_updated",
          organizationId,
          conversationId: String(conversation.id),
          fallback: { cliente: contact.name, canal: "whatsapp", mensagem: body || "[midia]" },
        });

        return withXml(
          twimlMessage(
            `${quickGuidance ? `${quickGuidance}\n\n` : ""}Perfeito, obrigado pelas informações. Encaminhei seu chamado para o técnico responsável da fila *${String(currentQueue?.name || "Suporte")}* para continuidade.${outOfHoursSuffix}`,
          ),
        );
      }

      const reply = await buildInvestigationAiReply({
        roundIndex: attempts,
        body: body || (mediaType?.startsWith("image/") ? "[imagem]" : ""),
        mediaUrl: finalMediaUrl,
        mimeType: mediaType,
        queueName: String(currentQueue?.name || "Suporte"),
      });

      await updateConversationById(organizationId, String(conversation.id), {
        menuAttempts: attempts + 1,
        status: "aguardando",
      });
      void sendWillTalkWebhook({
        event: "ticket_updated",
        organizationId,
        conversationId: String(conversation.id),
        fallback: { cliente: contact.name, canal: "whatsapp", mensagem: body || "[midia]" },
      });

      return withXml(twimlMessage(`${reply}${outOfHoursSuffix}`));
    }

    const selectedOption = Number.parseInt(body, 10);
    const queue = queues.find((item) => Number(item.menuOption) === selectedOption);

    if (Number.isInteger(selectedOption) && queue) {
      const dueAt = new Date(Date.now() + Number(queue.defaultSlaMins || 30) * 60 * 1000);

      await updateConversationById(organizationId, String(conversation.id), {
        queueId: String(queue.id),
        triageCompleted: false,
        menuAttempts: 0,
        status: "aguardando",
      });

      await updateTicketByConversation(organizationId, String(conversation.id), {
        queueId: String(queue.id),
        firstResponseDueAt: dueAt,
      });

      emitRealtime(organizationId, "conversation.updated", {
        id: String(conversation.id),
        queueId: String(queue.id),
        status: "aguardando",
      });
      void sendWillTalkWebhook({
        event: "ticket_updated",
        organizationId,
        conversationId: String(conversation.id),
        fallback: {
          cliente: contact.name,
          canal: "whatsapp",
          mensagem: body || "[midia]",
        },
      });

      return withXml(twimlMessage(buildInvestigationPrompt(String(queue.name))));
    }

    const nextAttempts = Number(conversation.menuAttempts || 0) + 1;

    if (nextAttempts >= 3) {
      await updateConversationById(organizationId, String(conversation.id), {
        triageCompleted: true,
        menuAttempts: nextAttempts,
        status: "aguardando",
      });

      emitRealtime(organizationId, conversation.isNew ? "conversation.created" : "conversation.updated", {
        id: String(conversation.id),
        status: "aguardando",
      });
      void sendWillTalkWebhook({
        event: "ticket_updated",
        organizationId,
        conversationId: String(conversation.id),
        fallback: {
          cliente: contact.name,
          canal: "whatsapp",
          mensagem: body || "[midia]",
        },
      });

      return withXml(
        twimlMessage(
          `Nao consegui identificar a opcao selecionada. Seu chamado foi encaminhado para atendimento humano.${outOfHoursSuffix}`,
        ),
      );
    }

    await updateConversationById(organizationId, String(conversation.id), {
      menuAttempts: nextAttempts,
    });
    void sendWillTalkWebhook({
      event: "ticket_updated",
      organizationId,
      conversationId: String(conversation.id),
      fallback: {
        cliente: contact.name,
        canal: "whatsapp",
        mensagem: body || "[midia]",
      },
    });

    const menu = buildDemandMenu(
      queues.map((q) => ({
        menuOption: Number(q.menuOption),
        name: String(q.name),
      })),
      contact.name,
    );

    return withXml(twimlMessage(`${menu}\n\nTentativa ${nextAttempts}/3.${outOfHoursSuffix}`));
  }

  await updateConversationById(organizationId, String(conversation.id), {
    status: conversation.status === "encerrado" ? "aguardando" : conversation.status,
  });

  emitRealtime(organizationId, conversation.isNew ? "conversation.created" : "conversation.updated", {
    id: String(conversation.id),
    status: conversation.status === "encerrado" ? "aguardando" : conversation.status,
  });
  void sendWillTalkWebhook({
    event: "ticket_updated",
    organizationId,
    conversationId: String(conversation.id),
    fallback: {
      cliente: contact.name,
      canal: "whatsapp",
      mensagem: body || "[midia]",
    },
  });

  return withXml(twimlMessage(`Mensagem recebida. Um atendente continuara o atendimento por aqui.${outOfHoursSuffix}`));
}
