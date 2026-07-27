import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import {
  getBusinessAccessUser,
  recordBusinessAccessAudit,
  revokeBusinessSessions,
} from "@/lib/business-access/business-access-repository";
import { requestIdFrom } from "@/lib/observability";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "admin_business_access", "admin");
  if (denied) return denied;
  const { id } = await context.params;
  const requestId = requestIdFrom(request);
  const existing = await getBusinessAccessUser(auth.session.organizationId, id);
  if (!existing) {
    return NextResponse.json({ error: "Acesso não encontrado", requestId }, { status: 404 });
  }
  const revoked = await revokeBusinessSessions(
    auth.session.organizationId,
    id,
    "admin_revocation",
  );
  await recordBusinessAccessAudit({
    organizationId: auth.session.organizationId,
    accessUserId: id,
    phoneNormalized: existing.phoneNormalized,
    eventType: "session_revoked",
    source: "ui",
    requestId,
    metadata: { revokedSessions: revoked },
  });
  return NextResponse.json({ revokedSessions: revoked, requestId });
}
