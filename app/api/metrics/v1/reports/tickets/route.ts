import { metricsEnvelope, metricsError } from "@/lib/metrics/envelope";
import { requireMetricsAccess } from "@/lib/metrics/guard";
import { PeriodError, resolvePeriod } from "@/lib/metrics/period";
import { MAX_PAGE_SIZE, linhasDeTicket, ReportError } from "@/lib/metrics/tickets-report";
import { getOrganizationTimeZone } from "@/lib/organization-timezone";

export const dynamic = "force-dynamic";

function primeiroFiltro(url: URL, principal: string, alias: string): string | null {
  const valor = url.searchParams.get(principal) ?? url.searchParams.get(alias);
  return valor?.trim() || null;
}

function limiteDaUrl(valor: string | null): number {
  if (valor === null) return 50;
  if (!/^\d+$/.test(valor)) throw new ReportError("Limite inválido");
  const limite = Number(valor);
  if (!Number.isSafeInteger(limite) || limite < 1 || limite > MAX_PAGE_SIZE) {
    throw new ReportError(`O limite precisa estar entre 1 e ${MAX_PAGE_SIZE}`);
  }
  return limite;
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
    const data = await linhasDeTicket(session.organizationId, periodo, filtros, {
      cursor: url.searchParams.get("cursor"),
      limite: limiteDaUrl(url.searchParams.get("limite")),
    });

    return metricsEnvelope(data, {
      period: { from: periodo.from.toISOString(), to: periodo.to.toISOString() },
      comparison: null,
      timezone,
      generatedAt: new Date().toISOString(),
      filters: { queueId: filtros.queueId, assigneeId: filtros.assigneeId },
    });
  } catch (erro) {
    if (erro instanceof PeriodError) return metricsError(erro.code, erro.message);
    if (erro instanceof ReportError) return metricsError("invalid_request", erro.message);
    return metricsError("internal", "Não foi possível gerar o relatório de tickets");
  }
}
