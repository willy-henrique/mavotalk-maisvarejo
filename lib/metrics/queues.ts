import { queryTenantDatabase } from "@/lib/db";
import type { FiltrosMetrica } from "@/lib/metrics/overview";
import type { ResolvedPeriod } from "@/lib/metrics/period";

export type MetricasFila = {
  id: string;
  nome: string;
  cor: string;
  tickets: number;
  tmeSegundos: number | null;
  slaEstourado: number;
};

type LinhaFila = {
  id: unknown;
  nome: unknown;
  cor: unknown;
  tickets: unknown;
  tme: unknown;
  sla_estourado: unknown;
};

const SQL = `
  WITH ticket_stats AS (
    SELECT
      queue_id,
      count(*) AS tickets,
      avg(EXTRACT(EPOCH FROM (first_response_at - created_at)))
        FILTER (WHERE first_response_at IS NOT NULL) AS tme,
      count(*) FILTER (WHERE first_response_sla_breached_at IS NOT NULL) AS sla_estourado
    FROM tickets
    WHERE organization_id = $1
      AND created_at >= $2
      AND created_at < $3
      AND ($4::text IS NULL OR queue_id = $4)
      AND ($5::text IS NULL OR assignee_id = $5)
    GROUP BY queue_id
  ),
  filas_relevantes AS (
    SELECT queue.id, queue.name, queue.color_hex
    FROM queues queue
    WHERE queue.organization_id = $1
      AND ($4::text IS NULL OR queue.id = $4)
      AND (
        queue.is_active = true
        OR EXISTS (
          SELECT 1 FROM ticket_stats WHERE ticket_stats.queue_id = queue.id
        )
      )
  )
  SELECT *
  FROM (
    SELECT
      fila.id,
      fila.name AS nome,
      fila.color_hex AS cor,
      COALESCE(ticket_stats.tickets, 0) AS tickets,
      ticket_stats.tme,
      COALESCE(ticket_stats.sla_estourado, 0) AS sla_estourado
    FROM filas_relevantes fila
    LEFT JOIN ticket_stats ON ticket_stats.queue_id = fila.id

    UNION ALL

    SELECT
      'sem-fila' AS id,
      'Sem fila' AS nome,
      '#70778D' AS cor,
      ticket_stats.tickets,
      ticket_stats.tme,
      ticket_stats.sla_estourado
    FROM ticket_stats
    WHERE ticket_stats.queue_id IS NULL
      AND $4::text IS NULL
  ) resultado
  ORDER BY tickets DESC, nome
`;

function contagem(valor: unknown): number {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error("Contagem por fila inválida");
  }
  return numero;
}

function duracaoOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) throw new Error("TME por fila inválido");
  return numero;
}

export async function metricasPorFila(
  organizationId: string,
  periodo: ResolvedPeriod,
  filtros: FiltrosMetrica,
): Promise<MetricasFila[]> {
  const resultado = await queryTenantDatabase<LinhaFila>(organizationId, SQL, [
    organizationId,
    periodo.from.toISOString(),
    periodo.to.toISOString(),
    filtros.queueId,
    filtros.assigneeId,
  ]);

  return resultado.rows.map((linha) => {
    const id = String(linha.id ?? "").trim();
    const nome = String(linha.nome ?? "").trim();
    const cor = String(linha.cor ?? "").trim();
    if (!id || !nome || !cor) throw new Error("Fila inválida no agregado");
    const tickets = contagem(linha.tickets);
    const slaEstourado = contagem(linha.sla_estourado);
    if (slaEstourado > tickets) throw new Error("SLA por fila inconsistente");
    return {
      id,
      nome,
      cor,
      tickets,
      tmeSegundos: duracaoOuNulo(linha.tme),
      slaEstourado,
    };
  });
}
