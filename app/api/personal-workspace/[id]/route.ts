import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { deletePersonalWorkspaceItem, updatePersonalWorkspaceItem } from "@/lib/personal-workspace";
import { personalInput } from "@/lib/workspace-input";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "personal_workspace", "update");
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const item = await updatePersonalWorkspaceItem(auth.session.organizationId, auth.session.userId, id, personalInput(await request.json(), true));
    return item ? NextResponse.json({ item }) : NextResponse.json({ error: "Item não encontrado." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Dados inválidos." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "personal_workspace", "delete");
  if (denied) return denied;
  const { id } = await context.params;
  const deleted = await deletePersonalWorkspaceItem(auth.session.organizationId, auth.session.userId, id);
  return deleted ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Item não encontrado." }, { status: 404 });
}
