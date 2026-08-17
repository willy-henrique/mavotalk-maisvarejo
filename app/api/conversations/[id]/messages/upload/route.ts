import { NextResponse } from "next/server";
import twilio from "twilio";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { addOutboundMessage, getContactById, getConversation } from "@/lib/repo";
import { emitRealtime } from "@/lib/realtime";
import { sendWhatsappMessage } from "@/lib/whatsapp-client";
import { deleteCloudinaryResources, uploadBase64ToCloudinary } from "@/lib/cloudinary";
import { getSupermarketSettings } from "@/lib/supermarket-settings";
import {
  buildAgentWhatsappMessage,
  resolveAgentSignature,
} from "@/lib/agent-message";
import { logger } from "@/lib/logger";
import {
  MAX_MESSAGE_ATTACHMENT_BYTES,
  validateMessageAttachment,
} from "@/lib/message-attachment-validation";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "inbox", "create");
  if (denied) return denied;

  const { id } = await context.params;
  const conversation = await getConversation(auth.session.organizationId, id);
  if (!conversation) {
    return NextResponse.json({ error: "Conversa nao encontrada" }, { status: 404 });
  }

  if (!conversation.contactPhone) {
    return NextResponse.json({ error: "Numero do contato nao disponivel" }, { status: 400 });
  }
  const contact = await getContactById(auth.session.organizationId, conversation.contactId);
  if (contact?.blocked) {
    return NextResponse.json({ error: "Contato bloqueado para mensagens" }, { status: 409 });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_MESSAGE_ATTACHMENT_BYTES + 512 * 1024) {
    return NextResponse.json({ error: "O anexo excede o limite de 16 MB" }, { status: 413 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json(
      { error: "Selecione uma imagem ou um arquivo PDF" },
      { status: 400 },
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  let attachment: ReturnType<typeof validateMessageAttachment>;
  try {
    attachment = validateMessageAttachment(file, buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Anexo inválido";
    const status = file.size > MAX_MESSAGE_ATTACHMENT_BYTES ? 413 : 400;
    return NextResponse.json({ error: message }, { status });
  }
  const base64 = buffer.toString("base64");
  const upload = await uploadBase64ToCloudinary(base64, attachment.mimeType);
  if (!upload) {
    return NextResponse.json({ error: "Falha ao armazenar o anexo" }, { status: 500 });
  }

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_WHATSAPP_NUMBER;
  const provider = process.env.WHATSAPP_PROVIDER || "twilio";
  const signatureValue = formData.get("withSignature");
  const signatureOverride =
    signatureValue === "true" ? true : signatureValue === "false" ? false : undefined;
  const { agentSignatureEnabled } = await getSupermarketSettings(
    auth.session.organizationId,
  );
  const useSignature = resolveAgentSignature(
    signatureOverride,
    agentSignatureEnabled,
  );
  const outboundCaption = buildAgentWhatsappMessage(
    attachment.placeholder,
    auth.session.name,
    useSignature,
  );

  let externalId: string | undefined;

  try {
    if (provider === "unofficial") {
      externalId = await sendWhatsappMessage(conversation.contactPhone, outboundCaption, {
        skipRateLimit: true,
        mediaUrl: upload.secure_url,
        mimeType: attachment.mimeType,
        fileName: attachment.fileName,
      });
    } else if (twilioSid && twilioToken && twilioFrom) {
      const client = twilio(twilioSid, twilioToken);
      const sent = await client.messages.create({
        from: twilioFrom,
        to: String(conversation.contactPhone),
        body: outboundCaption,
        mediaUrl: [upload.secure_url],
      });
      externalId = sent.sid;
    } else {
      throw new Error("Outbound WhatsApp provider is not configured");
    }
  } catch (err) {
    logger.error(
      { err, provider, organizationId: auth.session.organizationId, conversationId: id },
      "Failed to deliver outbound WhatsApp attachment",
    );
    await deleteCloudinaryResources(
      [upload.public_id],
      attachment.kind === "document" ? "raw" : "image",
    ).catch((cleanupError) => {
      logger.warn({ err: cleanupError, publicId: upload.public_id }, "Failed to clean orphaned upload");
    });
    return NextResponse.json(
      { error: "Não foi possível entregar o anexo no WhatsApp. Tente novamente." },
      { status: 503 },
    );
  }

  const message = await addOutboundMessage(
    auth.session.organizationId,
    id,
    attachment.placeholder,
    externalId,
    {
      authorId: auth.session.userId,
      type: attachment.kind,
      mediaUrl: upload.secure_url,
      mimeType: attachment.mimeType,
      cloudinaryPublicId: upload.public_id,
    },
  );

  emitRealtime(auth.session.organizationId, "message.created", { conversationId: id, message });
  emitRealtime(auth.session.organizationId, "conversation.updated", { id, status: "em_atendimento" });

  return NextResponse.json({ message, signatureApplied: useSignature }, { status: 201 });
}
