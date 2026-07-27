import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { dashboardMetrics } from "@/lib/repo";

export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "dashboard", "read");
  if (denied) return denied;

  const metrics = await dashboardMetrics(auth.session.organizationId);
  return NextResponse.json({ metrics });
}
