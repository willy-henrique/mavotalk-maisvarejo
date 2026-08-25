import { queryTenantDatabase } from "@/lib/db";

export type SnapshotAgora = {
  naFila: number;
  emAtendimento: number;
  pendenteCliente: number;
  esperaMaisLongaSegundos: number | null;
  slaEmRisco: number;
};

type LinhaSnapshot = {
  na_fila: unknown;
  em_atendimento: unknown;
  pendente_cliente: unknown;
  espera_mais_longa: unknown;
  sla_em_risco: unknown;
};

const SQL = `
  WITH conversas AS (
    SELECT
      count(*) FILTER (WHERE status = 'aguardando')        AS na_fila,
      count(*) FILTER (WHERE status = 'em_atendimento')    AS em_atendimento,
      count(*) FILTER (WHERE status = 'pendente_cliente')  AS pendente_cliente,
      min(created_at) FILTER (WHERE status = 'aguardando') AS mais_antiga
    FROM conversations
    WHERE organization_id = $1 AND status <> 'encerrado'
  ),
  risco AS (
    SELECT count(*) AS sla_em_risco
    FROM tickets
    WHERE organization_id = $1
      AND closed_at IS NULL
      AND first_response_at IS NULL
      AND first_response_sla_breached_at IS NULL
      AND first_response_due_at > now()
      AND first_response_due_at <= now() + interval '5 minutes'
  )
  SELECT
    conversas.na_fila,
    conversas.em_atendimento,
    conversas.pendente_cliente,
    EXTRACT(EPOCH FROM (now() - conversas.mais_antiga)) AS espera_mais_longa,
    risco.sla_em_risco
  FROM conversas, risco
`;

function inteiroNaoNegativo(valor: unknown): number {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error("Agregado de contagem inválido");
  }
  return numero;
}

function segundosOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error("Agregado de duração inválido");
  }
  return Math.round(numero);
}

export async function snapshotAgora(organizationId: string): Promise<SnapshotAgora> {
  const resultado = await queryTenantDatabase<LinhaSnapshot>(organizationId, SQL, [
    organizationId,
  ]);
  const linha = resultado.rows[0];
  if (!linha) throw new Error("Snapshot atual não retornou resultado");

  return {
    naFila: inteiroNaoNegativo(linha.na_fila),
    emAtendimento: inteiroNaoNegativo(linha.em_atendimento),
    pendenteCliente: inteiroNaoNegativo(linha.pendente_cliente),
    esperaMaisLongaSegundos: segundosOuNulo(linha.espera_mais_longa),
    slaEmRisco: inteiroNaoNegativo(linha.sla_em_risco),
  };
}
