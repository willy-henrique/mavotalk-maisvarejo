import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { saveBusinessLocation } from "@/lib/queue-automation";
import { businessLocationSchema } from "@/lib/queue-automation-schemas";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(); if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "admin_types", "update"); if (denied) return denied;
  const parsed = businessLocationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados da unidade inválidos.", details: parsed.error.flatten() }, { status: 422 });
  const { id } = await context.params; const location = await saveBusinessLocation(auth.session.organizationId, id, parsed.data);
  return NextResponse.json({ location });
}
