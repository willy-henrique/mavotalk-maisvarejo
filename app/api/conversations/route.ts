import { NextRequest, NextResponse } from "next/server";
import { listConversations, type ConversationStatus } from "@/lib/repo";
import { requireSession } from "@/lib/api";
import { logger } from "@/lib/logger";

const allowedStatus = new Set<ConversationStatus>(["aguardando", "em_atendimento", "pendente_cliente", "encerrado"]);

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

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
