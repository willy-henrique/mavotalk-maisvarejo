import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { createAuditLog, deleteQueue, updateQueue } from "@/lib/repo";
import { queueSchema } from "@/lib/schemas";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = await requireMenuPermission(auth.session, "admin_types", "update");
  if (denied) return denied;

  const body = await request.json();
  const parsed = queueSchema.partial().safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = await context.params;
  let queue;
  try {
    queue = await updateQueue(auth.session.organizationId, id, parsed.data);
  } catch (error) {
    if (error instanceof Error && error.message.includes("não podem mudar de opção")) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
  if (!queue) {
    return NextResponse.json({ error: "Demanda nao encontrada" }, { status: 404 });
  }

  await createAuditLog(auth.session.organizationId, auth.session.userId, "update_queue", "queue", id, parsed.data);

  return NextResponse.json({ queue });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = await requireMenuPermission(auth.session, "admin_types", "delete");
  if (denied) return denied;

  const { id } = await context.params;
  const result = await deleteQueue(auth.session.organizationId, id);
  if (result === "not_found") return NextResponse.json({ error: "Fila não encontrada" }, { status: 404 });
  if (result === "protected") return NextResponse.json({ error: "As filas de Ofertas, Horários e Falar com atendente são padrão do sistema e não podem ser excluídas. Você pode personalizar suas configurações." }, { status: 409 });
  if (result === "in_use") {
    return NextResponse.json({ error: "Esta fila possui atendimentos vinculados e não pode ser excluída." }, { status: 409 });
  }

  await createAuditLog(auth.session.organizationId, auth.session.userId, "delete_queue", "queue", id);
  return NextResponse.json({ ok: true });
}
