import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { createRemoteAccess, listRemoteAccesses } from "@/lib/remote-accesses";
import { remoteAccessInput } from "@/lib/workspace-input";

export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "remote_accesses", "read");
  if (denied) return denied;
  return NextResponse.json({ items: await listRemoteAccesses(auth.session.organizationId) });
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "remote_accesses", "create");
  if (denied) return denied;
  try {
    const parsed = remoteAccessInput(await request.json(), false);
    const item = await createRemoteAccess(auth.session.organizationId, auth.session.userId, {
      provider: parsed.provider!, label: parsed.label!, address: parsed.address!, username: parsed.username ?? null,
      location: parsed.location ?? null, responsibleName: parsed.responsibleName ?? null, notes: parsed.notes || "",
      tags: parsed.tags || [], isActive: parsed.isActive !== false, secret: parsed.secret,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Dados inválidos." }, { status: 400 });
  }
}
