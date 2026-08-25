import { queryTenantDatabase } from "@/lib/db";
import type { FiltrosMetrica } from "@/lib/metrics/overview";
import type { ResolvedPeriod } from "@/lib/metrics/period";

export const MAX_REPORT_ROWS = 5_000;
export const MAX_PAGE_SIZE = 200;

export type LinhaRelatorioTicket = {
  id: string;
  criadoEm: string;
  encerradoEm: string | null;
  contatoNome: string;
  contatoTelefone: string;
  fila: string;
  atendente: string;
  status: string;
  motivoEncerramento: string | null;
  tmeSegundos: number | null;
  tmaSegundos: number | null;
  slaEstourado: boolean;
  csat: number | null;
};

export type ResultadoRelatorioTickets = {
  linhas: LinhaRelatorioTicket[];
  total: number;
  proximoCursor: string | null;
};

export type PaginacaoRelatorio = {
  cursor: string | null;
  limite: number;
};

type CursorRelatorio = {
  createdAt: string;
  id: string;
  consumidas: number;
};

type LinhaBanco = {
  id: unknown;
  criado_em: unknown;
  encerrado_em: unknown;
  contato_nome: unknown;
  contato_telefone: unknown;
  fila: unknown;
  atendente: unknown;
  status: unknown;
  motivo_encerramento: unknown;
  tme: unknown;
  tma: unknown;
  sla_estourado: unknown;
  csat: unknown;
};

type LinhaContagem = { total: unknown };

export class ReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportError";
  }
}

const SQL_CONTAGEM = `
  SELECT count(*) AS total
  FROM tickets ticket
  WHERE ticket.organization_id = $1
    AND ticket.created_at >= $2
    AND ticket.created_at < $3
    AND ($4::text IS NULL OR ticket.queue_id = $4)
    AND ($5::text IS NULL OR ticket.assignee_id = $5)
`;

const SQL_PAGINA = `
  SELECT
    ticket.id,
    ticket.created_at AS criado_em,
    ticket.closed_at AS encerrado_em,
    contact.name AS contato_nome,
    COALESCE(conversation.contact_phone, contact.phone_number) AS contato_telefone,
    COALESCE(queue.name, 'Sem fila') AS fila,
    COALESCE(assignee.name, 'Não atribuído') AS atendente,
    conversation.status::text AS status,
    ticket.close_reason AS motivo_encerramento,
    EXTRACT(EPOCH FROM (ticket.first_response_at - ticket.created_at)) AS tme,
    EXTRACT(EPOCH FROM (ticket.closed_at - ticket.created_at)) AS tma,
    ticket.first_response_sla_breached_at IS NOT NULL AS sla_estourado,
    ticket.satisfaction_score AS csat
  FROM tickets ticket
  JOIN conversations conversation
    ON conversation.id = ticket.conversation_id
   AND conversation.organization_id = $1
  JOIN contacts contact
    ON contact.id = conversation.contact_id
   AND contact.organization_id = $1
  LEFT JOIN queues queue
    ON queue.id = ticket.queue_id
   AND queue.organization_id = $1
  LEFT JOIN users assignee
    ON assignee.id = ticket.assignee_id
   AND assignee.organization_id = $1
  WHERE ticket.organization_id = $1
    AND ticket.created_at >= $2
    AND ticket.created_at < $3
    AND ($4::text IS NULL OR ticket.queue_id = $4)
    AND ($5::text IS NULL OR ticket.assignee_id = $5)
    AND (
      $6::timestamptz IS NULL
      OR (ticket.created_at, ticket.id) < ($6::timestamptz, $7::text)
    )
  ORDER BY ticket.created_at DESC, ticket.id DESC
  LIMIT $8
`;

function inteiroNaoNegativo(valor: unknown, campo: string): number {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error(`${campo} inválido no relatório`);
  }
  return numero;
}

function numeroNaoNegativoOuNulo(valor: unknown, campo: string): number | null {
  if (valor === null || valor === undefined) return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error(`${campo} inválido no relatório`);
  }
  return numero;
}

function dataIso(valor: unknown, campo: string): string {
  const data = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(data.getTime())) throw new Error(`${campo} inválida no relatório`);
  return data.toISOString();
}

function dataIsoOuNula(valor: unknown, campo: string): string | null {
  return valor === null || valor === undefined ? null : dataIso(valor, campo);
}

function textoObrigatorio(valor: unknown, campo: string): string {
  const texto = String(valor ?? "").trim();
  if (!texto) throw new Error(`${campo} ausente no relatório`);
  return texto;
}

function decodificarCursor(valor: string | null): CursorRelatorio | null {
  if (!valor) return null;
  if (valor.length > 512) throw new ReportError("Cursor inválido");

  try {
    const carga = JSON.parse(Buffer.from(valor, "base64url").toString("utf8")) as unknown;
    if (!carga || typeof carga !== "object" || Array.isArray(carga)) {
      throw new Error("formato");
    }
    const cursor = carga as Record<string, unknown>;
    const createdAt = String(cursor.createdAt ?? "");
    const id = String(cursor.id ?? "").trim();
    const consumidas = Number(cursor.consumidas);
    if (
      Number.isNaN(new Date(createdAt).getTime())
      || !id
      || id.length > 160
      || !Number.isSafeInteger(consumidas)
      || consumidas < 1
      || consumidas >= MAX_REPORT_ROWS
    ) {
      throw new Error("conteúdo");
    }
    return { createdAt: new Date(createdAt).toISOString(), id, consumidas };
  } catch (erro) {
    if (erro instanceof ReportError) throw erro;
    throw new ReportError("Cursor inválido");
  }
}

function codificarCursor(cursor: CursorRelatorio): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function validarLimite(limite: number): number {
  if (!Number.isSafeInteger(limite) || limite < 1 || limite > MAX_PAGE_SIZE) {
    throw new ReportError(`O limite precisa estar entre 1 e ${MAX_PAGE_SIZE}`);
  }
  return limite;
}

function mapearLinha(linha: LinhaBanco): LinhaRelatorioTicket {
  const csat = numeroNaoNegativoOuNulo(linha.csat, "CSAT");
  if (csat !== null && (csat < 1 || csat > 5)) {
    throw new Error("CSAT inválido no relatório");
  }

  return {
    id: textoObrigatorio(linha.id, "Ticket"),
    criadoEm: dataIso(linha.criado_em, "Data de criação"),
    encerradoEm: dataIsoOuNula(linha.encerrado_em, "Data de encerramento"),
    contatoNome: textoObrigatorio(linha.contato_nome, "Contato"),
    contatoTelefone: textoObrigatorio(linha.contato_telefone, "Telefone"),
    fila: textoObrigatorio(linha.fila, "Fila"),
    atendente: textoObrigatorio(linha.atendente, "Atendente"),
    status: textoObrigatorio(linha.status, "Status"),
    motivoEncerramento:
      linha.motivo_encerramento === null || linha.motivo_encerramento === undefined
        ? null
        : String(linha.motivo_encerramento).trim() || null,
    tmeSegundos: numeroNaoNegativoOuNulo(linha.tme, "TME"),
    tmaSegundos: numeroNaoNegativoOuNulo(linha.tma, "TMA"),
    slaEstourado: linha.sla_estourado === true,
    csat,
  };
}

export async function linhasDeTicket(
  organizationId: string,
  periodo: ResolvedPeriod,
  filtros: FiltrosMetrica,
  paginacao: PaginacaoRelatorio,
): Promise<ResultadoRelatorioTickets> {
  const limite = validarLimite(paginacao.limite);
  const cursor = decodificarCursor(paginacao.cursor);
  const consumidas = cursor?.consumidas ?? 0;
  const restantes = Math.max(0, MAX_REPORT_ROWS - consumidas);
  const tamanhoDaConsulta = Math.min(limite, restantes);
  const valoresBase = [
    organizationId,
    periodo.from.toISOString(),
    periodo.to.toISOString(),
    filtros.queueId,
    filtros.assigneeId,
  ];

  const contagem = queryTenantDatabase<LinhaContagem>(organizationId, SQL_CONTAGEM, valoresBase);
  const pagina = tamanhoDaConsulta > 0
    ? queryTenantDatabase<LinhaBanco>(organizationId, SQL_PAGINA, [
        ...valoresBase,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        tamanhoDaConsulta,
      ])
    : Promise.resolve({ rows: [] as LinhaBanco[] });

  const [resultadoContagem, resultadoPagina] = await Promise.all([contagem, pagina]);
  const totalBanco = inteiroNaoNegativo(resultadoContagem.rows[0]?.total, "Total");
  const total = Math.min(totalBanco, MAX_REPORT_ROWS);
  const linhas = resultadoPagina.rows.map(mapearLinha);
  const novoTotalConsumido = consumidas + linhas.length;
  const ultima = linhas.at(-1);
  const proximoCursor = ultima && novoTotalConsumido < total
    ? codificarCursor({ createdAt: ultima.criadoEm, id: ultima.id, consumidas: novoTotalConsumido })
    : null;

  return { linhas, total, proximoCursor };
}
