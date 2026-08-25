import { NextResponse } from "next/server";
import { metricsError } from "@/lib/metrics/envelope";
import { requireMetricsAccess } from "@/lib/metrics/guard";
import { snapshotAgora } from "@/lib/metrics/live";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const acesso = await requireMetricsAccess(request);
  if (acesso.error) return acesso.error;
  const { session } = acesso;

  try {
    const data = await snapshotAgora(session.organizationId);
    return NextResponse.json({
      data,
      meta: { generatedAt: new Date().toISOString() },
    });
  } catch {
    return metricsError("internal", "Não foi possível consultar o estado atual");
  }
}
