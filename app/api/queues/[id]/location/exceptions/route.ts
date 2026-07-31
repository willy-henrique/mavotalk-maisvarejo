import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { recordQueueContentHistory, saveBusinessHourException } from "@/lib/queue-automation";
import { businessHourExceptionSchema } from "@/lib/queue-automation-schemas";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(); if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "admin_types", "update"); if (denied) return denied;
  const parsed = businessHourExceptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Exceção inválida.", details: parsed.error.flatten() }, { status: 422 });
  const { id } = await context.params; const exception = await saveBusinessHourException(auth.session.organizationId, id, parsed.data);
  await recordQueueContentHistory(auth.session.organizationId, id, auth.session.userId, "save_business_hour_exception", null, parsed.data);
  return NextResponse.json({ exception }, { status: 201 });
}
