import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { archiveQueuePromotion, deleteQueuePromotion, recordQueueContentHistory, updateQueuePromotion } from "@/lib/queue-automation";
import { promotionPatchInputSchema } from "@/lib/queue-automation-schemas";

export async function DELETE(_: Request, context: { params: Promise<{ id: string; promotionId: string }> }) {
  const auth = await requireSession(); if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "admin_types", "delete"); if (denied) return denied;
  const { id, promotionId } = await context.params;
  const promotion = await deleteQueuePromotion(auth.session.organizationId, id, promotionId);
  if (!promotion) return NextResponse.json({ error: "Promoção não encontrada." }, { status: 404 });
  await recordQueueContentHistory(auth.session.organizationId, id, auth.session.userId, "delete_promotion", { promotionId, title: promotion.title }, null);
  return NextResponse.json({ deleted: true });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; promotionId: string }> }) {
  const auth = await requireSession(); if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "admin_types", "update"); if (denied) return denied;
  const parsed = promotionPatchInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados da promoção inválidos.", details: parsed.error.flatten() }, { status: 422 });
  const { id, promotionId } = await context.params; const promotion = await updateQueuePromotion(auth.session.organizationId, id, promotionId, auth.session.userId, parsed.data);
  if (!promotion) return NextResponse.json({ error: "Promoção não encontrada." }, { status: 404 });
  await recordQueueContentHistory(auth.session.organizationId, id, auth.session.userId, "update_promotion", null, { promotionId, ...parsed.data });
  return NextResponse.json({ promotion });
}

export async function POST(request: Request, context: { params: Promise<{ id: string; promotionId: string }> }) {
  const auth = await requireSession(); if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "admin_types", "update"); if (denied) return denied;
  if (new URL(request.url).searchParams.get("action") !== "archive") return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  const { id, promotionId } = await context.params; const promotion = await archiveQueuePromotion(auth.session.organizationId, id, promotionId, auth.session.userId);
  if (!promotion) return NextResponse.json({ error: "Promoção não encontrada." }, { status: 404 });
  await recordQueueContentHistory(auth.session.organizationId, id, auth.session.userId, "archive_promotion", null, { promotionId });
  return NextResponse.json({ promotion });
}
