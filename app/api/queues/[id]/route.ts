import { NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/api";
import { createAuditLog, updateQueue } from "@/lib/repo";
import { queueSchema } from "@/lib/schemas";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = requireRole(["admin", "gestor"], auth.session.role);
  if (denied) return denied;

  const body = await request.json();
  const parsed = queueSchema.partial().safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = await context.params;
  const queue = await updateQueue(auth.session.organizationId, id, parsed.data);
  if (!queue) {
    return NextResponse.json({ error: "Demanda nao encontrada" }, { status: 404 });
  }

  await createAuditLog(auth.session.organizationId, auth.session.userId, "update_queue", "queue", id, parsed.data);

  return NextResponse.json({ queue });
}
