import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { revokeAgent } from "@/lib/agent-cloud/agent-repository";
import { createAuditLog } from "@/lib/repo";
import { requestIdFrom } from "@/lib/observability";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "business_sync", "delete");
  if (denied) return denied;
  const { id } = await context.params;
  const requestId = requestIdFrom(request);
  const revoked = await revokeAgent(auth.session.organizationId, id);
  if (!revoked) {
    return NextResponse.json({ error: "Agente não encontrado", requestId }, { status: 404 });
  }
  await createAuditLog(
    auth.session.organizationId,
    auth.session.userId,
    "revoke_agent",
    "agent_installation",
    id,
    { requestId },
  );
  return NextResponse.json({ revoked: true, requestId });
}
