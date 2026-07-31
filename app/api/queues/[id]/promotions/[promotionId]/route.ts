import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { archiveQueuePromotion } from "@/lib/queue-automation";

export async function POST(request: Request, context: { params: Promise<{ id: string; promotionId: string }> }) {
  const auth = await requireSession(); if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "admin_types", "update"); if (denied) return denied;
  if (new URL(request.url).searchParams.get("action") !== "archive") return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  const { id, promotionId } = await context.params; const promotion = await archiveQueuePromotion(auth.session.organizationId, id, promotionId, auth.session.userId);
  if (!promotion) return NextResponse.json({ error: "Promoção não encontrada." }, { status: 404 });
  return NextResponse.json({ promotion });
}
