import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { provisionAgent } from "@/lib/agent-cloud/agent-repository";
import { createAuditLog } from "@/lib/repo";
import { requestIdFrom, sanitizedError } from "@/lib/observability";

const schema = z.object({ name: z.string().trim().min(2).max(200) }).strict();

export async function POST(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "business_sync", "create");
  if (denied) return denied;
  const requestId = requestIdFrom(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido", requestId }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", requestId }, { status: 400 });
  }

  try {
    const provisioned = await provisionAgent({
      organizationId: auth.session.organizationId,
      name: parsed.data.name,
      createdByUserId: auth.session.userId,
    });
    await createAuditLog(
      auth.session.organizationId,
      auth.session.userId,
      "provision_agent",
      "agent_installation",
      provisioned.agent.id,
      { requestId, keyVersion: provisioned.keyVersion },
    );
    return NextResponse.json(provisioned, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: sanitizedError(error), requestId },
      { status: 500 },
    );
  }
}
