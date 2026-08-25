import { queryTenantDatabase } from "@/lib/db";
import type { ResolvedPeriod } from "@/lib/metrics/period";

export type DesempenhoBot = {
  conversas: number;
  resolvidasSemHumano: number;
  transferidas: number;
  taxaTransferencia: number | null;
  opcoesInvalidas: number;
  triagemConcluida: number;
};

type LinhaBot = {
  conversas: unknown;
  resolvidas_sem_humano: unknown;
  transferidas: unknown;
  opcoes_invalidas: unknown;
  triagem_concluida: unknown;
};

const SQL = `
  SELECT
    count(*) AS conversas,
    count(*) FILTER (
      WHERE conversation.status = 'encerrado'
        AND conversation.triage_completed = false
        AND ticket.assignee_id IS NULL
    ) AS resolvidas_sem_humano,
    count(*) FILTER (WHERE ticket.assignee_id IS NOT NULL) AS transferidas,
    COALESCE(sum(GREATEST(conversation.menu_attempts, 0)), 0) AS opcoes_invalidas,
    count(*) FILTER (WHERE conversation.triage_completed = true) AS triagem_concluida
  FROM conversations conversation
  LEFT JOIN tickets ticket
    ON ticket.organization_id = $1
   AND ticket.conversation_id = conversation.id
  WHERE conversation.organization_id = $1
    AND conversation.created_at >= $2
    AND conversation.created_at < $3
`;

function contagem(valor: unknown): number {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error("Agregado do atendimento automático inválido");
  }
  return numero;
}

export async function desempenhoDoBot(
  organizationId: string,
  periodo: ResolvedPeriod,
): Promise<DesempenhoBot> {
  const resultado = await queryTenantDatabase<LinhaBot>(organizationId, SQL, [
    organizationId,
    periodo.from.toISOString(),
    periodo.to.toISOString(),
  ]);
  const linha = resultado.rows[0];
  if (!linha) throw new Error("Atendimento automático não retornou agregado");

  const conversas = contagem(linha.conversas);
  const resolvidasSemHumano = contagem(linha.resolvidas_sem_humano);
  const transferidas = contagem(linha.transferidas);
  const triagemConcluida = contagem(linha.triagem_concluida);
  if (
    resolvidasSemHumano + transferidas > conversas ||
    triagemConcluida > conversas
  ) {
    throw new Error("Agregados do atendimento automático são inconsistentes");
  }

  return {
    conversas,
    resolvidasSemHumano,
    transferidas,
    taxaTransferencia: conversas > 0 ? transferidas / conversas : null,
    opcoesInvalidas: contagem(linha.opcoes_invalidas),
    triagemConcluida,
  };
}
