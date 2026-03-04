import { NextResponse } from "next/server";
import twilio from "twilio";
import { requireSession } from "@/lib/api";
import { addOutboundMessage, getConversation } from "@/lib/repo";
import { emitRealtime } from "@/lib/realtime";
import { sendWhatsappMessage } from "@/lib/whatsapp-client";
import { uploadBase64ToCloudinary } from "@/lib/cloudinary";

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

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file || !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Envie uma imagem valida" }, { status: 400 });
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
      mediaUrl: upload.secure_url,
    });
    externalId = sent.sid;
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

  emitRealtime("message.created", { conversationId: id, message });
  emitRealtime("conversation.updated", { id, status: "em_atendimento" });

  return NextResponse.json({ message }, { status: 201 });
}
