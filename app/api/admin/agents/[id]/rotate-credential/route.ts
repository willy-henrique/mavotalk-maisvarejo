import { NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/api";
import { rotateAgentCredential } from "@/lib/agent-cloud/agent-repository";
import { createAuditLog } from "@/lib/repo";
import { requestIdFrom, sanitizedError } from "@/lib/observability";

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
  try {
    const rotated = await rotateAgentCredential(
      auth.session.organizationId,
      id,
    );
    if (!rotated) {
      return NextResponse.json(
        { error: "Agente não encontrado ou revogado", requestId },
        { status: 404 },
      );
    }
    await createAuditLog(
      auth.session.organizationId,
      auth.session.userId,
      "rotate_agent_credential",
      "agent_installation",
      id,
      { requestId, keyVersion: rotated.keyVersion },
    );
    return NextResponse.json(rotated);
  } catch (error) {
    return NextResponse.json(
      { error: sanitizedError(error), requestId },
      { status: 500 },
    );
  }
}
