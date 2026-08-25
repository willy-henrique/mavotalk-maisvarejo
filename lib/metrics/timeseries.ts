import { queryTenantDatabase } from "@/lib/db";
import type { FiltrosMetrica } from "@/lib/metrics/overview";
import type { ResolvedPeriod } from "@/lib/metrics/period";

export type Granularidade = "hour" | "day";

export type BaldeSerie = {
  instante: string;
  tickets: number;
  mensagens: number;
};

type LinhaSerie = {
  instante: Date | string;
  tickets: unknown;
  mensagens: unknown;
};

const DOIS_DIAS_MS = 2 * 24 * 60 * 60 * 1000;

export function granularidadeParaJanela(duracaoMs: number): Granularidade {
  return duracaoMs <= DOIS_DIAS_MS ? "hour" : "day";
}

function montarSql(granularidade: Granularidade, passo: "1 hour" | "1 day"): string {
  return `
    WITH baldes AS (
      SELECT generate_series(
        date_trunc('${granularidade}', $2::timestamptz AT TIME ZONE $4),
        date_trunc(
          '${granularidade}',
          ($3::timestamptz - interval '1 microsecond') AT TIME ZONE $4
        ),
        interval '${passo}'
      ) AS instante_local
    ),
    t AS (
      SELECT
        date_trunc('${granularidade}', created_at AT TIME ZONE $4) AS instante_local,
        count(*) AS total
      FROM tickets
      WHERE organization_id = $1
        AND created_at >= $2
        AND created_at < $3
        AND ($5::text IS NULL OR queue_id = $5)
        AND ($6::text IS NULL OR assignee_id = $6)
      GROUP BY 1
    ),
    m AS (
      SELECT
        date_trunc('${granularidade}', created_at AT TIME ZONE $4) AS instante_local,
        count(*) AS total
      FROM messages
      WHERE organization_id = $1
        AND created_at >= $2
        AND created_at < $3
        AND (
          ($5::text IS NULL AND $6::text IS NULL)
          OR EXISTS (
            SELECT 1
            FROM tickets ticket_filtro
            WHERE ticket_filtro.organization_id = $1
              AND ticket_filtro.conversation_id = messages.conversation_id
              AND ($5::text IS NULL OR ticket_filtro.queue_id = $5)
              AND ($6::text IS NULL OR ticket_filtro.assignee_id = $6)
          )
        )
      GROUP BY 1
    )
    SELECT
      baldes.instante_local AT TIME ZONE $4 AS instante,
      COALESCE(t.total, 0) AS tickets,
      COALESCE(m.total, 0) AS mensagens
    FROM baldes
    LEFT JOIN t USING (instante_local)
    LEFT JOIN m USING (instante_local)
    ORDER BY baldes.instante_local
  `;
}

const SQL_POR_GRANULARIDADE: Record<Granularidade, string> = {
  hour: montarSql("hour", "1 hour"),
  day: montarSql("day", "1 day"),
};

function contagem(valor: unknown): number {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error("Agregado da série temporal inválido");
  }
  return numero;
}

export async function serieTemporal(
  organizationId: string,
  periodo: ResolvedPeriod,
  granularidade: Granularidade,
  filtros: FiltrosMetrica,
): Promise<BaldeSerie[]> {
  const resultado = await queryTenantDatabase<LinhaSerie>(
    organizationId,
    SQL_POR_GRANULARIDADE[granularidade],
    [
      organizationId,
      periodo.from.toISOString(),
      periodo.to.toISOString(),
      periodo.timezone,
      filtros.queueId,
      filtros.assigneeId,
    ],
  );

  return resultado.rows.map((linha) => {
    const instante = new Date(linha.instante);
    if (Number.isNaN(instante.getTime())) {
      throw new Error("Instante da série temporal inválido");
    }
    return {
      instante: instante.toISOString(),
      tickets: contagem(linha.tickets),
      mensagens: contagem(linha.mensagens),
    };
  });
}
