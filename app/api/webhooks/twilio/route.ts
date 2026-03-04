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
import { buildDemandMenu, normalizePhone } from "@/lib/utils";

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
  const rawBody = await request.text();
  const params = new URLSearchParams(rawBody);

  const signature = request.headers.get("x-twilio-signature") || "";
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (token) {
    const asObject = Object.fromEntries(params.entries());
    const valid = twilio.validateRequest(token, signature, request.url, asObject);
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
      // On Firestore/network error, process message anyway to avoid losing it
    }
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

  emitRealtime("message.created", { conversationId: conversation.id, message: inbound });

  const queues = (await listQueues(organizationId)).filter((q) => q.isActive !== false);

  const businessOpen = await isOpenBusinessHour(new Date(), organizationId);
  const outOfHoursSuffix = businessOpen
    ? ""
    : "\n\nEstamos fora do horario comercial no momento. Seu chamado foi registrado e responderemos no proximo expediente.";

  if (!conversation.triageCompleted) {
    const selectedOption = Number.parseInt(body, 10);
    const queue = queues.find((item) => Number(item.menuOption) === selectedOption);

    if (Number.isInteger(selectedOption) && queue) {
      const dueAt = new Date(Date.now() + Number(queue.defaultSlaMins || 30) * 60 * 1000);

      await updateConversationById(String(conversation.id), {
        queueId: String(queue.id),
        triageCompleted: true,
        status: "aguardando",
      });

      await updateTicketByConversation(organizationId, String(conversation.id), {
        queueId: String(queue.id),
        firstResponseDueAt: dueAt,
      });

      emitRealtime("conversation.updated", {
        id: String(conversation.id),
        queueId: String(queue.id),
        status: "aguardando",
      });

      return withXml(
        twimlMessage(`Demanda *${String(queue.name)}* registrada. Seu chamado esta na fila de atendimento.${outOfHoursSuffix}`),
      );
    }

    const nextAttempts = Number(conversation.menuAttempts || 0) + 1;

    if (nextAttempts >= 3) {
      await updateConversationById(String(conversation.id), {
        triageCompleted: true,
        menuAttempts: nextAttempts,
        status: "aguardando",
      });

      emitRealtime(conversation.isNew ? "conversation.created" : "conversation.updated", {
        id: String(conversation.id),
        status: "aguardando",
      });

      return withXml(
        twimlMessage(
          `Nao consegui identificar a opcao selecionada. Seu chamado foi encaminhado para atendimento humano.${outOfHoursSuffix}`,
        ),
      );
    }

    await updateConversationById(String(conversation.id), {
      menuAttempts: nextAttempts,
    });

    const menu = buildDemandMenu(
      queues.map((q) => ({
        menuOption: Number(q.menuOption),
        name: String(q.name),
      })),
    );

    return withXml(twimlMessage(`${menu}\n\nTentativa ${nextAttempts}/3.${outOfHoursSuffix}`));
  }

  await updateConversationById(String(conversation.id), {
    status: conversation.status === "encerrado" ? "aguardando" : conversation.status,
  });

  emitRealtime(conversation.isNew ? "conversation.created" : "conversation.updated", {
    id: String(conversation.id),
    status: conversation.status === "encerrado" ? "aguardando" : conversation.status,
  });

  return withXml(twimlMessage(`Mensagem recebida. Um atendente continuara o atendimento por aqui.${outOfHoursSuffix}`));
}
