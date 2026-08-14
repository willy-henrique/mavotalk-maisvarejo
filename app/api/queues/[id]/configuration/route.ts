import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { getOrganizationTimeZone } from "@/lib/organization-timezone";
import { getQueueAutomation, listBusinessLocationContent, listQueueAutomationHistory, listQueuePromotions, publishQueueAutomation, saveQueueAutomationDraft, discardQueueAutomationDraft } from "@/lib/queue-automation";
import { queueConfigurationInputSchema } from "@/lib/queue-automation-schemas";
import { isMenuOptionConflict, menuOptionConflictMessage } from "@/lib/queue-menu-option";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const result = await requireSession();
  if (result.error) return result.error;
  if (!result.session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const denied = await requireMenuPermission(result.session, "admin_types", "read"); if (denied) return denied;
  const { id } = await context.params;
  const [draft, published, history] = await Promise.all([getQueueAutomation(result.session.organizationId, id, "draft"), getQueueAutomation(result.session.organizationId, id, "published"), listQueueAutomationHistory(result.session.organizationId, id)]);
  if (!draft && !published) return NextResponse.json({ error: "Fila não encontrada." }, { status: 404 });
  const queueType = draft?.queueType || published?.queueType;
  const content = queueType === "offers_promotions" ? { promotions: await listQueuePromotions(result.session.organizationId, id) } : queueType === "business_hours_location" ? await listBusinessLocationContent(result.session.organizationId, id) : {};
  // O editor precisa do fuso da loja para mostrar e gravar o período das promoções
  // no mesmo relógio que o bot usa na mensagem enviada ao cliente.
  const timeZone = await getOrganizationTimeZone(result.session.organizationId, id);
  return NextResponse.json({ draft, published, history, content, timeZone });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const result = await requireSession();
  if (result.error) return result.error;
  if (!result.session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const denied = await requireMenuPermission(result.session, "admin_types", "update"); if (denied) return denied;
  const body = await request.json().catch(() => null); const parsed = queueConfigurationInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos.", details: parsed.error.flatten() }, { status: 422 });
  const { id } = await context.params;
  let saved: Awaited<ReturnType<typeof saveQueueAutomationDraft>>;
  try {
    saved = await saveQueueAutomationDraft(result.session.organizationId, id, result.session.userId, parsed.data);
  } catch (error) {
    if (isMenuOptionConflict(error)) return NextResponse.json({ error: menuOptionConflictMessage(null) }, { status: 409 });
    throw error;
  }
  if (!saved) return NextResponse.json({ error: "Fila não encontrada." }, { status: 404 });
  return NextResponse.json({ configuration: saved.configuration, menuOptionSwap: saved.menuOptionSwap });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const result = await requireSession();
  if (result.error) return result.error;
  if (!result.session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const denied = await requireMenuPermission(result.session, "admin_types", "update"); if (denied) return denied;
  const { id } = await context.params; const action = new URL(request.url).searchParams.get("action");
  if (action === "publish") {
    // O corpo é opcional: quando vem, publicar também grava o que está na tela.
    const body = await request.json().catch(() => null);
    const draft = body === null || body === undefined ? null : queueConfigurationInputSchema.safeParse(body);
    if (draft && !draft.success) return NextResponse.json({ error: "Dados inválidos.", details: draft.error.flatten() }, { status: 422 });
    try {
      const published = await publishQueueAutomation(result.session.organizationId, id, result.session.userId, draft?.data);
      if (published.configuration) return NextResponse.json(published);
      // Sem um `error` em texto a UI mostraria só "Unprocessable Entity" e o
      // motivo real da recusa ("cadastre o endereço", etc.) se perderia.
      return NextResponse.json({ ...published, error: Object.values(published.errors).join(" ") }, { status: 422 });
    } catch (error) {
      if (isMenuOptionConflict(error)) return NextResponse.json({ error: menuOptionConflictMessage(null) }, { status: 409 });
      throw error;
    }
  }
  if (action === "discard") { await discardQueueAutomationDraft(result.session.organizationId, id, result.session.userId); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}
