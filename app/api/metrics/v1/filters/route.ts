import { opcoesDeFiltro } from "@/lib/metrics/filters";
import { metricsEnvelope, metricsError } from "@/lib/metrics/envelope";
import { requireMetricsAccess } from "@/lib/metrics/guard";
import { PeriodError, resolvePeriod } from "@/lib/metrics/period";
import { getOrganizationTimeZone } from "@/lib/organization-timezone";

export const dynamic = "force-dynamic";

function primeiroFiltro(url: URL, principal: string, alias: string): string | null {
  const valor = url.searchParams.get(principal) ?? url.searchParams.get(alias);
  return valor?.trim() || null;
}

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
    const filtros = {
      queueId: primeiroFiltro(url, "fila", "queue_id"),
      assigneeId: primeiroFiltro(url, "atendente", "assignee_id"),
    };
    const data = await opcoesDeFiltro(session.organizationId);

    return metricsEnvelope(data, {
      period: {
        from: periodo.from.toISOString(),
        to: periodo.to.toISOString(),
      },
      comparison: {
        from: periodo.comparison.from.toISOString(),
        to: periodo.comparison.to.toISOString(),
      },
      timezone,
      generatedAt: new Date().toISOString(),
      filters: {
        queueId: filtros.queueId,
        assigneeId: filtros.assigneeId,
      },
    });
  } catch (erro) {
    if (erro instanceof PeriodError) return metricsError(erro.code, erro.message);
    return metricsError("internal", "Não foi possível consultar os filtros disponíveis");
  }
}
