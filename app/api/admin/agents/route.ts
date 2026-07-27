import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { listAgents } from "@/lib/agent-cloud/agent-repository";

export async function GET(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "business_sync", "read");
  if (denied) return denied;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("pageSize")) || 25),
  );
  const query = url.searchParams.get("q")?.trim().slice(0, 100) || undefined;
  const statusValue = url.searchParams.get("status");
  const status = statusValue && ["online", "attention", "revoked"].includes(statusValue)
    ? statusValue as "online" | "attention" | "revoked"
    : undefined;
  const result = await listAgents(auth.session.organizationId, {
    page,
    pageSize,
    query,
    status,
  });
  return NextResponse.json({ ...result, page, pageSize });
}
