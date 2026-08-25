import { queryTenantDatabase } from "@/lib/db";
import type { FiltrosMetrica } from "@/lib/metrics/overview";
import type { ResolvedPeriod } from "@/lib/metrics/period";

export type ProducaoAtendente = {
  id: string;
  nome: string;
  tickets: number;
  encerrados: number;
  tmeSegundos: number | null;
  tmaSegundos: number | null;
  csat: number | null;
  csatRespostas: number;
  mensagensEnviadas: number;
};

type LinhaAgente = {
  id: unknown;
  nome: unknown;
  tickets: unknown;
  encerrados: unknown;
  tme: unknown;
  tma: unknown;
  csat: unknown;
  csat_respostas: unknown;
  mensagens_enviadas: unknown;
};

const SQL = `
  WITH ticket_stats AS (
    SELECT
      assignee_id,
      count(*) AS tickets,
      count(*) FILTER (WHERE closed_at IS NOT NULL) AS encerrados,
      avg(EXTRACT(EPOCH FROM (first_response_at - created_at)))
        FILTER (WHERE first_response_at IS NOT NULL) AS tme,
      avg(EXTRACT(EPOCH FROM (closed_at - created_at)))
        FILTER (WHERE closed_at IS NOT NULL) AS tma,
      avg(satisfaction_score)
        FILTER (WHERE satisfaction_score BETWEEN 1 AND 5) AS csat,
      count(*) FILTER (WHERE satisfaction_score BETWEEN 1 AND 5) AS csat_respostas
    FROM tickets
    WHERE organization_id = $1
      AND created_at >= $2
      AND created_at < $3
      AND assignee_id IS NOT NULL
      AND ($4::text IS NULL OR queue_id = $4)
      AND ($5::text IS NULL OR assignee_id = $5)
    GROUP BY assignee_id
  ),
  message_stats AS (
    SELECT author_id, count(*) AS mensagens_enviadas
    FROM messages
    WHERE organization_id = $1
      AND created_at >= $2
      AND created_at < $3
      AND direction = 'outbound'
      AND author_id IS NOT NULL
      AND (
        $4::text IS NULL
        OR EXISTS (
          SELECT 1
          FROM tickets ticket_filtro
          WHERE ticket_filtro.organization_id = $1
            AND ticket_filtro.conversation_id = messages.conversation_id
            AND ticket_filtro.queue_id = $4
        )
      )
    GROUP BY author_id
  )
  SELECT
    u.id,
    u.name AS nome,
    COALESCE(ticket_stats.tickets, 0) AS tickets,
    COALESCE(ticket_stats.encerrados, 0) AS encerrados,
    ticket_stats.tme,
    ticket_stats.tma,
    ticket_stats.csat,
    COALESCE(ticket_stats.csat_respostas, 0) AS csat_respostas,
    COALESCE(message_stats.mensagens_enviadas, 0) AS mensagens_enviadas
  FROM users u
  LEFT JOIN ticket_stats ON ticket_stats.assignee_id = u.id
  LEFT JOIN message_stats ON message_stats.author_id = u.id
  WHERE u.organization_id = $1
    AND u.is_active = true
    AND u.role = 'atendente'
    AND ($5::text IS NULL OR u.id = $5)
  ORDER BY tickets DESC, u.name
`;

function contagem(valor: unknown): number {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error("Contagem de produção inválida");
  }
  return numero;
}

function numeroNaoNegativoOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error("Indicador de produção inválido");
  }
  return numero;
}

export async function producaoPorAtendente(
  organizationId: string,
  periodo: ResolvedPeriod,
  filtros: FiltrosMetrica,
): Promise<ProducaoAtendente[]> {
  const resultado = await queryTenantDatabase<LinhaAgente>(organizationId, SQL, [
    organizationId,
    periodo.from.toISOString(),
    periodo.to.toISOString(),
    filtros.queueId,
    filtros.assigneeId,
  ]);

  return resultado.rows.map((linha) => {
    const id = String(linha.id ?? "").trim();
    const nome = String(linha.nome ?? "").trim();
    if (!id || !nome) throw new Error("Atendente inválido no agregado de produção");
    return {
      id,
      nome,
      tickets: contagem(linha.tickets),
      encerrados: contagem(linha.encerrados),
      tmeSegundos: numeroNaoNegativoOuNulo(linha.tme),
      tmaSegundos: numeroNaoNegativoOuNulo(linha.tma),
      csat: numeroNaoNegativoOuNulo(linha.csat),
      csatRespostas: contagem(linha.csat_respostas),
      mensagensEnviadas: contagem(linha.mensagens_enviadas),
    };
  });
}
