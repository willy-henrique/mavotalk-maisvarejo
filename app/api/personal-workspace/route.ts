import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { createPersonalWorkspaceItem, listPersonalWorkspaceItems } from "@/lib/personal-workspace";
import { personalInput } from "@/lib/workspace-input";

export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "personal_workspace", "read");
  if (denied) return denied;
  return NextResponse.json({ items: await listPersonalWorkspaceItems(auth.session.organizationId, auth.session.userId) });
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "personal_workspace", "create");
  if (denied) return denied;
  try {
    const parsed = personalInput(await request.json(), false);
    const item = await createPersonalWorkspaceItem(auth.session.organizationId, auth.session.userId, {
      kind: parsed.kind!, title: parsed.title!, content: parsed.content || "", url: parsed.url ?? null,
      status: parsed.status || "open", priority: parsed.priority || "normal", dueAt: parsed.dueAt ?? null,
      isPinned: parsed.isPinned || false, tags: parsed.tags || [],
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Dados inválidos." }, { status: 400 });
  }
}
