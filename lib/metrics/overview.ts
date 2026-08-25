import { queryTenantDatabase } from "@/lib/db";
import type { ResolvedPeriod } from "@/lib/metrics/period";

export type FiltrosMetrica = {
  queueId: string | null;
  assigneeId: string | null;
};

export type BlocoPeriodo = {
  tickets: number;
  encerrados: number;
  taxaResolucao: number | null;
  tmeSegundos: number | null;
  tmaSegundos: number | null;
  slaEstourado: number;
  csat: number | null;
  csatRespostas: number;
  mensagensEnviadas: number;
  mensagensRecebidas: number;
};

export type Overview = {
  atual: BlocoPeriodo;
  anterior: BlocoPeriodo;
};

type LinhaTickets = {
  tickets: unknown;
  encerrados: unknown;
  sla_estourado: unknown;
  tme: unknown;
  tma: unknown;
  csat: unknown;
  csat_respostas: unknown;
};

type LinhaMensagens = {
  enviadas: unknown;
  recebidas: unknown;
};

const SQL_TICKETS = `
  SELECT
    count(*) AS tickets,
    count(*) FILTER (WHERE closed_at IS NOT NULL) AS encerrados,
    count(*) FILTER (WHERE first_response_sla_breached_at IS NOT NULL) AS sla_estourado,
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
    AND ($4::text IS NULL OR queue_id = $4)
    AND ($5::text IS NULL OR assignee_id = $5)
`;

const SQL_MENSAGENS = `
  SELECT
    count(*) FILTER (WHERE direction = 'outbound') AS enviadas,
    count(*) FILTER (WHERE direction = 'inbound') AS recebidas
  FROM messages
  WHERE organization_id = $1
    AND created_at >= $2
    AND created_at < $3
    AND (
      ($4::text IS NULL AND $5::text IS NULL)
      OR EXISTS (
        SELECT 1
        FROM tickets ticket_filtro
        WHERE ticket_filtro.organization_id = $1
          AND ticket_filtro.conversation_id = messages.conversation_id
          AND ($4::text IS NULL OR ticket_filtro.queue_id = $4)
          AND ($5::text IS NULL OR ticket_filtro.assignee_id = $5)
      )
    )
`;

function inteiroNaoNegativo(valor: unknown): number {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error("Agregado de contagem inválido");
  }
  return numero;
}

function numeroNaoNegativoOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error("Agregado numérico inválido");
  }
  return numero;
}

async function bloco(
  organizationId: string,
  de: Date,
  ate: Date,
  filtros: FiltrosMetrica,
): Promise<BlocoPeriodo> {
  const valores = [
    organizationId,
    de.toISOString(),
    ate.toISOString(),
    filtros.queueId,
    filtros.assigneeId,
  ];
  const [tickets, mensagens] = await Promise.all([
    queryTenantDatabase<LinhaTickets>(organizationId, SQL_TICKETS, valores),
    queryTenantDatabase<LinhaMensagens>(organizationId, SQL_MENSAGENS, valores),
  ]);
  const linhaTickets = tickets.rows[0];
  const linhaMensagens = mensagens.rows[0];
  if (!linhaTickets || !linhaMensagens) {
    throw new Error("Indicadores do período não retornaram resultado");
  }

  const total = inteiroNaoNegativo(linhaTickets.tickets);
  const encerrados = inteiroNaoNegativo(linhaTickets.encerrados);
  if (encerrados > total) throw new Error("Agregado de encerrados inconsistente");

  return {
    tickets: total,
    encerrados,
    taxaResolucao: total > 0 ? encerrados / total : null,
    tmeSegundos: numeroNaoNegativoOuNulo(linhaTickets.tme),
    tmaSegundos: numeroNaoNegativoOuNulo(linhaTickets.tma),
    slaEstourado: inteiroNaoNegativo(linhaTickets.sla_estourado),
    csat: numeroNaoNegativoOuNulo(linhaTickets.csat),
    csatRespostas: inteiroNaoNegativo(linhaTickets.csat_respostas),
    mensagensEnviadas: inteiroNaoNegativo(linhaMensagens.enviadas),
    mensagensRecebidas: inteiroNaoNegativo(linhaMensagens.recebidas),
  };
}

export async function overviewMetrics(
  organizationId: string,
  periodo: ResolvedPeriod,
  filtros: FiltrosMetrica,
): Promise<Overview> {
  const [atual, anterior] = await Promise.all([
    bloco(organizationId, periodo.from, periodo.to, filtros),
    bloco(organizationId, periodo.comparison.from, periodo.comparison.to, filtros),
  ]);
  return { atual, anterior };
}
