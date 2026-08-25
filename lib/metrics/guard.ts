import { randomUUID, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import * as auth from "@/lib/auth";
import type { SessionPayload } from "@/lib/auth";
import { queryTenantDatabase } from "@/lib/db";
import { metricsError } from "@/lib/metrics/envelope";
import { requestIdFrom } from "@/lib/observability";
import { consumeRateLimit, rateLimitSubject } from "@/lib/security/rate-limit";

type Resultado =
  | { error: NextResponse; session: null }
  | { error: null; session: SessionPayload };

class SessaoRevogadaError extends Error {}

const INTENTOS_DE_METRICAS = new Set([
  "agents",
  "bot",
  "filters",
  "live",
  "me",
  "overview",
  "queues",
  "reports",
  "timeseries",
  "users",
]);

export function metricsServiceTokenIsValid(recebido: string | null): boolean {
  const esperado = process.env.MAVO_METRICS_TOKEN || "";
  if (!esperado || !recebido) return false;

  const tokenRecebido = Buffer.from(recebido);
  const tokenEsperado = Buffer.from(esperado);
  if (tokenRecebido.length !== tokenEsperado.length) return false;
  return timingSafeEqual(tokenRecebido, tokenEsperado);
}

function queryTypeDaRota(request: Request): string {
  try {
    const pathname = new URL(request.url).pathname;
    const prefixo = "/api/metrics/v1/";
    if (!pathname.startsWith(prefixo)) return "metrics.unknown";

    const segmentos = pathname.slice(prefixo.length).split("/").filter(Boolean);
    const raiz = segmentos[0] || "";
    if (!INTENTOS_DE_METRICAS.has(raiz)) return "metrics.unknown";
    if (raiz === "reports" && segmentos[1] === "tickets") {
      return "metrics.reports.tickets";
    }
    return `metrics.${raiz}`;
  } catch {
    return "metrics.unknown";
  }
}

async function auditarConsulta(request: Request, session: SessionPayload): Promise<void> {
  const resultado = await queryTenantDatabase(
    session.organizationId,
    `INSERT INTO business_query_audit (
       id, organization_id, access_user_id, application_user_id,
       phone_normalized, conversation_reference, origin, query_type,
       sanitized_input, parameters_json, result_summary, status,
       error_code, duration_ms
     )
     SELECT
       $2, u.organization_id, NULL, u.id,
       NULL, NULL, 'api', $4,
       NULL, $5::jsonb, '{}'::jsonb, 'success',
       NULL, 0
     FROM users u
     WHERE u.organization_id = $1
       AND u.id = $3
       AND u.is_active = true
       AND u.role = $6`,
    [
      session.organizationId,
      randomUUID(),
      session.userId,
      queryTypeDaRota(request),
      JSON.stringify({ requestId: requestIdFrom(request) }),
      session.role,
    ],
  );

  if (resultado.rowCount !== 1) {
    throw new SessaoRevogadaError("A sessão não corresponde mais ao acesso atual");
  }
}

export async function requireMetricsAccess(request: Request): Promise<Resultado> {
  if (!metricsServiceTokenIsValid(request.headers.get("x-mavo-service-token"))) {
    return { error: metricsError("unauthenticated", "Origem não autorizada"), session: null };
  }

  const session = await auth.getSession();
  if (!session) {
    return { error: metricsError("unauthenticated", "Sessão expirada"), session: null };
  }

  if (session.role === "atendente") {
    return {
      error: metricsError("forbidden", "Este painel é para gestão"),
      session: null,
    };
  }

  const limite = await consumeRateLimit(
    "metrics",
    rateLimitSubject(`${session.organizationId}:${session.userId}`),
    60,
    60,
  );
  if (!limite.allowed) {
    return {
      error: metricsError("rate_limited", "Muitas consultas. Aguarde um instante."),
      session: null,
    };
  }

  try {
    await auditarConsulta(request, session);
  } catch (erro) {
    if (erro instanceof SessaoRevogadaError) {
      return {
        error: metricsError("forbidden", "Seu acesso foi alterado. Entre novamente."),
        session: null,
      };
    }
    return {
      error: metricsError("internal", "Não foi possível autorizar a consulta"),
      session: null,
    };
  }

  return { error: null, session };
}
