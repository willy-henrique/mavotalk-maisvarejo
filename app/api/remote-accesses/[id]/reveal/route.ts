import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { revealRemoteAccessSecret } from "@/lib/remote-accesses";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "remote_accesses", "admin");
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const secret = await revealRemoteAccessSecret(auth.session.organizationId, auth.session.userId, id);
    if (secret === null) return NextResponse.json({ error: "Acesso não encontrado." }, { status: 404 });
    if (!secret) return NextResponse.json({ error: "Este acesso não possui senha salva." }, { status: 404 });
    return NextResponse.json({ secret });
  } catch {
    return NextResponse.json({ error: "Não foi possível revelar o acesso. Verifique a configuração do cofre." }, { status: 503 });
  }
}
