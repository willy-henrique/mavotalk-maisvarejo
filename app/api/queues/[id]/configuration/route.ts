import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { getQueueAutomation, listBusinessLocationContent, listQueueAutomationHistory, listQueuePromotions, publishQueueAutomation, saveQueueAutomationDraft, discardQueueAutomationDraft } from "@/lib/queue-automation";
import { queueConfigurationInputSchema } from "@/lib/queue-automation-schemas";

async function auth(action: "read" | "update") {
  const result = await requireSession();
  if (result.error || !result.session) return result;
  const denied = await requireMenuPermission(result.session, "admin_types", action);
  return { ...result, error: denied };
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const result = await auth("read"); if (result.error || !result.session) return result.error;
  const { id } = await context.params;
  const [draft, published, history] = await Promise.all([getQueueAutomation(result.session.organizationId, id, "draft"), getQueueAutomation(result.session.organizationId, id, "published"), listQueueAutomationHistory(result.session.organizationId, id)]);
  if (!draft && !published) return NextResponse.json({ error: "Fila não encontrada." }, { status: 404 });
  const queueType = draft?.queueType || published?.queueType;
  const content = queueType === "offers_promotions" ? { promotions: await listQueuePromotions(result.session.organizationId, id) } : queueType === "business_hours_location" ? await listBusinessLocationContent(result.session.organizationId, id) : {};
  return NextResponse.json({ draft, published, history, content });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const result = await auth("update"); if (result.error || !result.session) return result.error;
  const body = await request.json().catch(() => null); const parsed = queueConfigurationInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos.", details: parsed.error.flatten() }, { status: 422 });
  const { id } = await context.params; const configuration = await saveQueueAutomationDraft(result.session.organizationId, id, result.session.userId, parsed.data);
  if (!configuration) return NextResponse.json({ error: "Fila não encontrada." }, { status: 404 });
  return NextResponse.json({ configuration });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const result = await auth("update"); if (result.error || !result.session) return result.error;
  const { id } = await context.params; const action = new URL(request.url).searchParams.get("action");
  if (action === "publish") { const published = await publishQueueAutomation(result.session.organizationId, id, result.session.userId); return published.configuration ? NextResponse.json(published) : NextResponse.json(published, { status: 422 }); }
  if (action === "discard") { await discardQueueAutomationDraft(result.session.organizationId, id, result.session.userId); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}
