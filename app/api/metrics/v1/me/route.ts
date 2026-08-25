import { NextResponse } from "next/server";
import { metricsError } from "@/lib/metrics/envelope";
import { requireMetricsAccess } from "@/lib/metrics/guard";
import { organizationForMetrics } from "@/lib/metrics/organization";
import { getOrganizationTimeZone } from "@/lib/organization-timezone";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const acesso = await requireMetricsAccess(request);
  if (acesso.error) return acesso.error;
  const { session } = acesso;

  try {
    const [organization, timezone] = await Promise.all([
      organizationForMetrics(session.organizationId, session.userId),
      getOrganizationTimeZone(session.organizationId),
    ]);

    return NextResponse.json({
      data: {
        user: {
          id: session.userId,
          name: session.name,
          email: session.email,
          role: session.role,
        },
        organization: { ...organization, timezone },
      },
    });
  } catch {
    return metricsError("internal", "Não foi possível carregar o perfil");
  }
}
