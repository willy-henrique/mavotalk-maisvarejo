import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { listContactsPage } from "@/lib/repo";

export async function GET(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "contacts", "read");
  if (denied) return denied;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 25));
  const query = url.searchParams.get("q")?.trim().slice(0, 100) || undefined;
  const status = url.searchParams.get("status");
  const blocked = status === "blocked" ? true : status === "unblocked" ? false : undefined;
  const result = await listContactsPage(auth.session.organizationId, { page, pageSize, query, blocked });
  return NextResponse.json({ ...result, page, pageSize });
}
