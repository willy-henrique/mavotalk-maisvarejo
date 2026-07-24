import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, requireSession } from "@/lib/api";
import {
  getBusinessAccessUser,
  recordBusinessAccessAudit,
  revokeBusinessSessions,
  updateBusinessAccessUser,
} from "@/lib/business-access/business-access-repository";
import { hashBusinessPin } from "@/lib/business-access/business-pin-service";
import { requestIdFrom } from "@/lib/observability";

const schema = z.object({ pin: z.string().regex(/^\d{6,12}$/) }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = requireRole(["admin"], auth.session.role);
  if (denied) return denied;
  const requestId = requestIdFrom(request);
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido", requestId }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "PIN inválido", requestId }, { status: 400 });
  }
  const existing = await getBusinessAccessUser(auth.session.organizationId, id);
  if (!existing) {
    return NextResponse.json({ error: "Acesso não encontrado", requestId }, { status: 404 });
  }
  await updateBusinessAccessUser(auth.session.organizationId, id, {
    pinHash: await hashBusinessPin(parsed.data.pin),
    mfaType: "pin",
  });
  await revokeBusinessSessions(auth.session.organizationId, id, "pin_reset");
  await recordBusinessAccessAudit({
    organizationId: auth.session.organizationId,
    accessUserId: id,
    phoneNormalized: existing.phoneNormalized,
    eventType: "pin_reset",
    source: "ui",
    requestId,
  });
  return NextResponse.json({ reset: true, sessionsRevoked: true, requestId });
}
