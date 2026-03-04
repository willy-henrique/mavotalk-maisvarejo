import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { assignConversation, createAuditLog, getConversation } from "@/lib/repo";
import { emitRealtime } from "@/lib/realtime";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const { id } = await context.params;
  const existing = await getConversation(auth.session.organizationId, id);
  if (!existing) {
    return NextResponse.json({ error: "Conversa nao encontrada" }, { status: 404 });
  }

  await assignConversation(auth.session.organizationId, id, auth.session.userId);

  await createAuditLog(auth.session.organizationId, auth.session.userId, "assign_ticket", "conversation", id, {
    assigneeId: auth.session.userId,
  });

  emitRealtime("conversation.updated", { id, status: "em_atendimento" });

  return NextResponse.json({ conversation: { id, status: "em_atendimento" } });
}
