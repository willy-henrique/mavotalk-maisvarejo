import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { listQuickReplies, createAuditLog, createQuickReply } from "@/lib/repo";
import { quickReplySchema } from "@/lib/schemas";

export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = await requireMenuPermission(auth.session, "admin_quick_replies", "read");
  if (denied) return denied;

  const items = await listQuickReplies(auth.session.organizationId);
  return NextResponse.json({ quickReplies: items });
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = await requireMenuPermission(auth.session, "admin_quick_replies", "create");
  if (denied) return denied;

  const body = await request.json();
  const parsed = quickReplySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const item = await createQuickReply(auth.session.organizationId, {
    name: parsed.data.name,
    content: parsed.data.content,
    category: parsed.data.category ?? null,
  });

  await createAuditLog(
    auth.session.organizationId,
    auth.session.userId,
    "create_quick_reply",
    "quick_reply",
    String(item.id),
    { name: item.name, category: item.category },
  );

  return NextResponse.json({ quickReply: item }, { status: 201 });
}
