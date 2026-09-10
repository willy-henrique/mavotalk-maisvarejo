import { queryTenantDatabase } from "@/lib/db";
import type { FiltrosMetrica } from "@/lib/metrics/overview";
import type { ResolvedPeriod } from "@/lib/metrics/period";

export const LIMITE_RANKING_CLIENTES = 10;

export type ClienteRecorrente = {
  id: string;
  nome: string;
  telefone: string;
  tickets: number;
  abertos: number;
  slaEstourado: number;
  avaliacoesNegativas: number;
  csat: number | null;
  ultimoChamadoEm: string;
  emAtencao: boolean;
};

export type MetricasClientes = {
  resumo: {
    clientesAtendidos: number;
    clientesRecorrentes: number;
    taxaRecorrencia: number | null;
    clientesEmAtencao: number;
  };
  ranking: ClienteRecorrente[];
};

type LinhaCliente = {
  id: unknown;
  nome: unknown;
  telefone: unknown;
  tickets: unknown;
  abertos: unknown;
  sla_estourado: unknown;
  avaliacoes_negativas: unknown;
  csat: unknown;
  ultimo_chamado_em: unknown;
  clientes_atendidos: unknown;
  clientes_recorrentes: unknown;
  clientes_em_atencao: unknown;
};

const SQL = `
  WITH clientes AS (
    SELECT
      contact.id,
      contact.name AS nome,
      COALESCE(MAX(NULLIF(conversation.contact_phone, '')), contact.phone_number) AS telefone,
      count(*) AS tickets,
      count(*) FILTER (WHERE ticket.closed_at IS NULL) AS abertos,
      count(*) FILTER (
        WHERE ticket.first_response_sla_breached_at IS NOT NULL
      ) AS sla_estourado,
      count(*) FILTER (
        WHERE ticket.satisfaction_score BETWEEN 1 AND 2
      ) AS avaliacoes_negativas,
      avg(ticket.satisfaction_score) FILTER (
        WHERE ticket.satisfaction_score BETWEEN 1 AND 5
      ) AS csat,
      max(ticket.created_at) AS ultimo_chamado_em
    FROM tickets ticket
    JOIN conversations conversation
      ON conversation.id = ticket.conversation_id
     AND conversation.organization_id = $1
    JOIN contacts contact
      ON contact.id = conversation.contact_id
     AND contact.organization_id = $1
    WHERE ticket.organization_id = $1
      AND ticket.created_at >= $2
      AND ticket.created_at < $3
      AND ($4::text IS NULL OR ticket.queue_id = $4)
      AND ($5::text IS NULL OR ticket.assignee_id = $5)
    GROUP BY contact.id, contact.name, contact.phone_number
  )
  SELECT
    clientes.*,
    count(*) OVER () AS clientes_atendidos,
    count(*) FILTER (WHERE tickets >= 2) OVER () AS clientes_recorrentes,
    count(*) FILTER (
      WHERE abertos > 0 OR sla_estourado > 0 OR avaliacoes_negativas > 0
    ) OVER () AS clientes_em_atencao
  FROM clientes
  ORDER BY tickets DESC, abertos DESC, sla_estourado DESC, ultimo_chamado_em DESC, nome
  LIMIT $6
`;

function contagem(valor: unknown, campo: string): number {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error(`${campo} inválido nas métricas de clientes`);
  }
  return numero;
}

function textoObrigatorio(valor: unknown, campo: string): string {
  const texto = String(valor ?? "").trim();
  if (!texto) throw new Error(`${campo} ausente nas métricas de clientes`);
  return texto;
}

function csatOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 1 || numero > 5) {
    throw new Error("CSAT inválido nas métricas de clientes");
  }
  return numero;
}

function dataIso(valor: unknown): string {
  const data = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(data.getTime())) {
    throw new Error("Data inválida nas métricas de clientes");
  }
  return data.toISOString();
}

export async function metricasPorCliente(
  organizationId: string,
  periodo: ResolvedPeriod,
  filtros: FiltrosMetrica,
): Promise<MetricasClientes> {
  const resultado = await queryTenantDatabase<LinhaCliente>(organizationId, SQL, [
    organizationId,
    periodo.from.toISOString(),
    periodo.to.toISOString(),
    filtros.queueId,
    filtros.assigneeId,
    LIMITE_RANKING_CLIENTES,
  ]);

  if (resultado.rows.length === 0) {
    return {
      resumo: {
        clientesAtendidos: 0,
        clientesRecorrentes: 0,
        taxaRecorrencia: null,
        clientesEmAtencao: 0,
      },
      ranking: [],
    };
  }

  const clientesAtendidos = contagem(resultado.rows[0].clientes_atendidos, "Clientes atendidos");
  const clientesRecorrentes = contagem(
    resultado.rows[0].clientes_recorrentes,
    "Clientes recorrentes",
  );
  const clientesEmAtencao = contagem(
    resultado.rows[0].clientes_em_atencao,
    "Clientes em atenção",
  );

  if (clientesRecorrentes > clientesAtendidos || clientesEmAtencao > clientesAtendidos) {
    throw new Error("Resumo inconsistente nas métricas de clientes");
  }

  const ranking = resultado.rows.map((linha) => {
    const tickets = contagem(linha.tickets, "Tickets");
    const abertos = contagem(linha.abertos, "Tickets abertos");
    const slaEstourado = contagem(linha.sla_estourado, "SLA estourado");
    const avaliacoesNegativas = contagem(linha.avaliacoes_negativas, "Avaliações negativas");
    if (abertos > tickets || slaEstourado > tickets || avaliacoesNegativas > tickets) {
      throw new Error("Cliente inconsistente no ranking de chamados");
    }

    return {
      id: textoObrigatorio(linha.id, "Cliente"),
      nome: textoObrigatorio(linha.nome, "Nome"),
      telefone: textoObrigatorio(linha.telefone, "Telefone"),
      tickets,
      abertos,
      slaEstourado,
      avaliacoesNegativas,
      csat: csatOuNulo(linha.csat),
      ultimoChamadoEm: dataIso(linha.ultimo_chamado_em),
      emAtencao: abertos > 0 || slaEstourado > 0 || avaliacoesNegativas > 0,
    };
  });

  return {
    resumo: {
      clientesAtendidos,
      clientesRecorrentes,
      taxaRecorrencia: clientesAtendidos > 0 ? clientesRecorrentes / clientesAtendidos : null,
      clientesEmAtencao,
    },
    ranking,
  };
}
