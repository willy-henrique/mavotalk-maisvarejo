import { NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/api";
import {
  getBusinessAccessUser,
  recordBusinessAccessAudit,
  unlockBusinessAccessUser,
} from "@/lib/business-access/business-access-repository";
import { requestIdFrom } from "@/lib/observability";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = requireRole(["admin"], auth.session.role);
  if (denied) return denied;
  const { id } = await context.params;
  const requestId = requestIdFrom(request);
  const existing = await getBusinessAccessUser(auth.session.organizationId, id);
  if (!existing || !(await unlockBusinessAccessUser(auth.session.organizationId, id))) {
    return NextResponse.json({ error: "Acesso não encontrado", requestId }, { status: 404 });
  }
  await recordBusinessAccessAudit({
    organizationId: auth.session.organizationId,
    accessUserId: id,
    phoneNormalized: existing.phoneNormalized,
    eventType: "access_unlocked",
    source: "ui",
    requestId,
  });
  return NextResponse.json({ unlocked: true, requestId });
}
