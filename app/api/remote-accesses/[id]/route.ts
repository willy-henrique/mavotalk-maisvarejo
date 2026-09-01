import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { updateRemoteAccess } from "@/lib/remote-accesses";
import { remoteAccessInput } from "@/lib/workspace-input";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "remote_accesses", "update");
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const item = await updateRemoteAccess(auth.session.organizationId, auth.session.userId, id, remoteAccessInput(await request.json(), true));
    return item ? NextResponse.json({ item }) : NextResponse.json({ error: "Acesso não encontrado." }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Dados inválidos." }, { status: 400 });
  }
}
