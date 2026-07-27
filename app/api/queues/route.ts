import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { createAuditLog, createQueue, listQueues } from "@/lib/repo";
import { queueSchema } from "@/lib/schemas";

export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = await requireMenuPermission(auth.session, "admin_types", "read");
  if (denied) return denied;

  const queues = await listQueues(auth.session.organizationId);
  return NextResponse.json({ queues });
}

export async function POST(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const denied = await requireMenuPermission(auth.session, "admin_types", "create");
  if (denied) return denied;

  const body = await request.json();
  const parsed = queueSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Dados invalidos", details: parsed.error.flatten() }, { status: 400 });
  }

  const queue = await createQueue(auth.session.organizationId, {
    ...parsed.data,
    isActive: parsed.data.isActive ?? true,
  });

  await createAuditLog(auth.session.organizationId, auth.session.userId, "create_queue", "queue", String(queue.id), {
    menuOption: parsed.data.menuOption,
    name: parsed.data.name,
  });

  return NextResponse.json({ queue }, { status: 201 });
}
