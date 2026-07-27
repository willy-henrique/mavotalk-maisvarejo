import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { listQuickRepliesPage, createAuditLog, createQuickReply } from "@/lib/repo";
import { quickReplySchema } from "@/lib/schemas";

export async function GET(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = await requireMenuPermission(auth.session, "admin_quick_replies", "read");
  if (denied) return denied;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 25));
  const query = url.searchParams.get("q")?.trim().slice(0, 100) || undefined;
  const result = await listQuickRepliesPage(auth.session.organizationId, { page, pageSize, query });
  return NextResponse.json({ items: result.items, total: result.total, page, pageSize });
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
