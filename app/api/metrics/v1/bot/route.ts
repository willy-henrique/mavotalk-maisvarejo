import { desempenhoDoBot } from "@/lib/metrics/bot";
import { metricsEnvelope, metricsError } from "@/lib/metrics/envelope";
import { requireMetricsAccess } from "@/lib/metrics/guard";
import { PeriodError, resolvePeriod } from "@/lib/metrics/period";
import { getOrganizationTimeZone } from "@/lib/organization-timezone";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const acesso = await requireMetricsAccess(request);
  if (acesso.error) return acesso.error;
  const { session } = acesso;
  const url = new URL(request.url);

  try {
    const timezone = await getOrganizationTimeZone(session.organizationId);
    const periodo = resolvePeriod({
      name: url.searchParams.get("periodo") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      timezone,
    });
    const data = await desempenhoDoBot(session.organizationId, periodo);

    return metricsEnvelope(data, {
      period: { from: periodo.from.toISOString(), to: periodo.to.toISOString() },
      comparison: {
        from: periodo.comparison.from.toISOString(),
        to: periodo.comparison.to.toISOString(),
      },
      timezone,
      generatedAt: new Date().toISOString(),
      filters: { queueId: null, assigneeId: null },
    });
  } catch (erro) {
    if (erro instanceof PeriodError) return metricsError(erro.code, erro.message);
    return metricsError("internal", "Não foi possível calcular o atendimento automático");
  }
}
