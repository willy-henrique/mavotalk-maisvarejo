import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { listAgentAuditEvents } from "@/lib/agent-cloud/agent-repository";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "business_sync", "read");
  if (denied) return denied;
  const { id } = await context.params;
  const items = await listAgentAuditEvents(auth.session.organizationId, id);
  return NextResponse.json({ items });
}
