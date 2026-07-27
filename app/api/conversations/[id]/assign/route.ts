import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { assignConversation, createAuditLog, getConversation } from "@/lib/repo";
import { emitRealtime } from "@/lib/realtime";
import { sendWillTalkWebhook } from "@/lib/willtalk-webhook";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "inbox", "update");
  if (denied) return denied;

  const { id } = await context.params;
  const existing = await getConversation(auth.session.organizationId, id);
  if (!existing) {
    return NextResponse.json({ error: "Conversa nao encontrada" }, { status: 404 });
  }

  await assignConversation(auth.session.organizationId, id, auth.session.userId);

  await createAuditLog(auth.session.organizationId, auth.session.userId, "assign_ticket", "conversation", id, {
    assigneeId: auth.session.userId,
  });

  emitRealtime(auth.session.organizationId, "conversation.updated", { id, status: "em_atendimento" });
  void sendWillTalkWebhook({
    event: "ticket_updated",
    organizationId: auth.session.organizationId,
    conversationId: id,
    fallback: {
      cliente: "Cliente",
      tecnico: auth.session.name,
      canal: "whatsapp",
    },
  });

  return NextResponse.json({ conversation: { id, status: "em_atendimento" } });
}
