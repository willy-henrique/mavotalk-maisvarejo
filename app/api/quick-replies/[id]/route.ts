import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/api";
import { updateQuickReply, deleteQuickReply } from "@/lib/repo";
import { quickReplySchema } from "@/lib/schemas";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = requireRole(["admin", "gestor", "atendente"], auth.session.role);
  if (denied) return denied;

  const { id } = await context.params;
  const body = await request.json();
  const parsed = quickReplySchema.partial().safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const updates: { name?: string; content?: string; category?: string | null } = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.content !== undefined) updates.content = parsed.data.content;
  if (parsed.data.category !== undefined) updates.category = parsed.data.category ?? null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 });
  }

  const item = await updateQuickReply(auth.session.organizationId, id, updates);
  if (!item) {
    return NextResponse.json({ error: "Resposta rapida nao encontrada" }, { status: 404 });
  }

  return NextResponse.json({ quickReply: item });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = requireRole(["admin", "gestor"], auth.session.role);
  if (denied) return denied;

  const { id } = await context.params;
  const deleted = await deleteQuickReply(auth.session.organizationId, id);
  if (!deleted) {
    return NextResponse.json({ error: "Resposta rapida nao encontrada" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
