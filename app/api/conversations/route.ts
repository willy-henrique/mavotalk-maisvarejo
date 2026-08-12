import { NextRequest, NextResponse } from "next/server";
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
import { sendWhatsappMessage, whatsappNumberExists } from "@/lib/whatsapp-client";
import { logger } from "@/lib/logger";

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

  const { phone, message, contactName } = parsed.data;
  const organizationId = auth.session.organizationId;

  if (await isContactBlocked(organizationId, phone)) {
    return NextResponse.json(
      { error: "Este contato está bloqueado. Desbloqueie antes de iniciar a conversa." },
      { status: 409 },
    );
  }

  // Um número digitado errado seria enviado para o vazio e ainda criaria contato e
  // conversa fantasmas no painel. `null` significa que não deu para verificar.
  const exists = await whatsappNumberExists(phone);
  if (exists === false) {
    return NextResponse.json(
      { error: "Este número não tem WhatsApp. Confira o DDI, o DDD e os dígitos." },
      { status: 422 },
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
    externalId = await sendWhatsappMessage(phone, outboundBody, { skipRateLimit: true });
  } catch (error) {
    logger.error({ err: error, organizationId, phone }, "Failed to start conversation on WhatsApp");
    // A conversa fica criada e atribuída, mas sem mensagem entregue seria enganoso
    // reportar sucesso: o atendente precisa saber que o cliente não recebeu nada.
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível enviar a mensagem pelo WhatsApp.",
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
    { phone, verifiedOnWhatsapp: exists },
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
