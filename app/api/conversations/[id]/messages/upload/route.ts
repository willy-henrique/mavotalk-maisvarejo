import { NextResponse } from "next/server";
import twilio from "twilio";
import { requireSession } from "@/lib/api";
import { addOutboundMessage, getContactById, getConversation } from "@/lib/repo";
import { emitRealtime } from "@/lib/realtime";
import { sendWhatsappMessage } from "@/lib/whatsapp-client";
import { deleteCloudinaryResources, uploadBase64ToCloudinary } from "@/lib/cloudinary";
import { logger } from "@/lib/logger";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

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
  if (contentLength > MAX_IMAGE_BYTES + 512 * 1024) {
    return NextResponse.json({ error: "Imagem excede o limite de 8 MB" }, { status: 413 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file || !ALLOWED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Envie uma imagem JPEG, PNG, WebP ou GIF" },
      { status: 400 },
    );
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Imagem excede o limite de 8 MB" }, { status: 413 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString("base64");
  const upload = await uploadBase64ToCloudinary(base64, file.type);
  if (!upload) {
    return NextResponse.json({ error: "Falha ao enviar imagem" }, { status: 500 });
  }

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_WHATSAPP_NUMBER;
  const provider = process.env.WHATSAPP_PROVIDER || "twilio";

  let externalId: string | undefined;

  try {
    if (provider === "unofficial") {
      externalId = await sendWhatsappMessage(conversation.contactPhone, "[imagem]", {
        skipRateLimit: true,
        mediaUrl: upload.secure_url,
      });
    } else if (twilioSid && twilioToken && twilioFrom) {
      const client = twilio(twilioSid, twilioToken);
      const sent = await client.messages.create({
        from: twilioFrom,
        to: String(conversation.contactPhone),
        body: `[${auth.session.name || "Atendente"}] Enviou uma imagem`,
        mediaUrl: [upload.secure_url],
      });
      externalId = sent.sid;
    } else {
      throw new Error("Outbound WhatsApp provider is not configured");
    }
  } catch (err) {
    logger.error(
      { err, provider, organizationId: auth.session.organizationId, conversationId: id },
      "Failed to deliver outbound WhatsApp image",
    );
    await deleteCloudinaryResources([upload.public_id]).catch((cleanupError) => {
      logger.warn({ err: cleanupError, publicId: upload.public_id }, "Failed to clean orphaned upload");
    });
    return NextResponse.json(
      { error: "Nao foi possivel entregar a imagem no WhatsApp. Tente novamente." },
      { status: 503 },
    );
  }

  const message = await addOutboundMessage(
    auth.session.organizationId,
    id,
    "[imagem]",
    externalId,
    {
      authorId: auth.session.userId,
      type: "image",
      mediaUrl: upload.secure_url,
      cloudinaryPublicId: upload.public_id,
    },
  );

  emitRealtime(auth.session.organizationId, "message.created", { conversationId: id, message });
  emitRealtime(auth.session.organizationId, "conversation.updated", { id, status: "em_atendimento" });

  return NextResponse.json({ message }, { status: 201 });
}
