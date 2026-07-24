import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/api";
import { listQuickReplies, createQuickReply } from "@/lib/repo";
import { quickReplySchema } from "@/lib/schemas";

export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const items = await listQuickReplies(auth.session.organizationId);
  return NextResponse.json({ quickReplies: items });
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = requireRole(["admin", "gestor"], auth.session.role);
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

  return NextResponse.json({ quickReply: item }, { status: 201 });
}
