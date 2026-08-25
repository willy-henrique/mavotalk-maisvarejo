import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import {
  createAuditLog,
  getConversation,
  listTeamForPresence,
  transferConversation,
} from "@/lib/repo";
import { emitRealtime } from "@/lib/realtime";
import { parseTransferRequest } from "@/lib/ticket-transfer";

/**
 * Passa o chamado para outro técnico, ou devolve para a fila.
 *
 * Rota própria, e não uma variação de `assign`, porque as duas gravam coisas
 * diferentes: puxar registra `first_response_at`, transferir não pode registrar.
 * Reusar aquela função faria cada transferência reescrever a hora da primeira
 * resposta e falsificar o SLA que a Visão da operação mostra.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "inbox", "update");
  if (denied) return denied;

  const { id } = await context.params;
  const conversation = await getConversation(auth.session.organizationId, id);
  if (!conversation) {
    return NextResponse.json({ error: "Conversa nao encontrada" }, { status: 404 });
  }
  if (conversation.status === "encerrado") {
    return NextResponse.json(
      { error: "Chamado encerrado não pode ser transferido." },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // A equipe vem do banco, filtrada pela organização da sessão: é ela que decide
  // para quem se pode transferir. Confiar no id que o cliente mandou permitiria
  // empurrar um chamado para um usuário de outro tenant.
  const team = await listTeamForPresence(auth.session.organizationId);
  const parsed = parseTransferRequest(
    {
      toUserId: typeof body.toUserId === "string" ? body.toUserId : undefined,
      toQueue: body.toQueue === true,
      note: typeof body.note === "string" ? body.note : undefined,
    },
    {
      currentUserId: auth.session.userId,
      // listTeamForPresence já traz só usuários ativos (WHERE is_active = true):
      // quem foi desativado simplesmente não está na lista e cai em "não
      // encontrado", que é a recusa correta.
      team: team.map((member) => ({ id: member.id, isActive: true })),
    },
  );
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const toUserId = parsed.target.kind === "user" ? parsed.target.userId : null;
  await transferConversation(auth.session.organizationId, id, {
    fromUserId: auth.session.userId,
    toUserId,
    note: parsed.note,
  });

  await createAuditLog(
    auth.session.organizationId,
    auth.session.userId,
    "transfer_ticket",
    "conversation",
    id,
    { fromUserId: auth.session.userId, toUserId, toQueue: toUserId === null, note: parsed.note },
  );

  const status = toUserId ? "em_atendimento" : "aguardando";
  emitRealtime(auth.session.organizationId, "conversation.updated", { id, status });
  emitRealtime(auth.session.organizationId, "conversation.transferred", {
    conversationId: id,
    toUserId,
    fromUserId: auth.session.userId,
    fromUserName: auth.session.name,
    note: parsed.note,
  });

  return NextResponse.json({
    conversation: { id, status },
    transfer: { toUserId, note: parsed.note },
  });
}
