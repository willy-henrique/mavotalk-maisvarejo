import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { createAuditLog, createQueue, listQueues } from "@/lib/repo";
import { queueSchema } from "@/lib/schemas";
import { isMenuOptionConflict, menuOptionConflictMessage } from "@/lib/queue-menu-option";

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

  if (parsed.data.isActive !== false && parsed.data.queueType && parsed.data.queueType !== "custom") {
    const existing = await listQueues(auth.session.organizationId);
    if (existing.some((queue) => queue.isActive && queue.queueType === parsed.data.queueType)) {
      return NextResponse.json({ error: "Já existe uma fila ativa deste tipo. Desative-a antes de criar outra." }, { status: 409 });
    }
  }

  let queue;
  try {
    queue = await createQueue(auth.session.organizationId, {
      ...parsed.data,
      isActive: parsed.data.isActive ?? true,
    });
  } catch (error) {
    if (isMenuOptionConflict(error)) {
      return NextResponse.json({ error: menuOptionConflictMessage(null) }, { status: 409 });
    }
    throw error;
  }

  await createAuditLog(auth.session.organizationId, auth.session.userId, "create_queue", "queue", String(queue.id), {
    menuOption: parsed.data.menuOption,
    name: parsed.data.name,
  });

  return NextResponse.json({ queue }, { status: 201 });
}
