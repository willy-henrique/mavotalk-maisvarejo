import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { queryTenantDatabase } from "@/lib/db";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "business_audit", "read");
  if (denied) return denied;
  const { id } = await context.params;
  const result = await queryTenantDatabase<{
    id: string; origin: string; query_type: string; status: string; error_code: string | null;
    duration_ms: number; created_at: Date; sanitized_input: string | null; parameters_json: Record<string, unknown>;
    result_summary: Record<string, unknown>; actor_name: string | null;
  }>(
    `SELECT a.id, a.origin, a.query_type, a.status, a.error_code, a.duration_ms, a.created_at,
            a.sanitized_input, a.parameters_json, a.result_summary, COALESCE(bau.name, u.name) AS actor_name
       FROM business_query_audit a
       LEFT JOIN business_access_users bau ON bau.id = a.access_user_id AND bau.organization_id = a.organization_id
       LEFT JOIN users u ON u.id = a.application_user_id AND u.organization_id = a.organization_id
      WHERE a.id = $1 AND a.organization_id = $2
      LIMIT 1`,
    auth.session.organizationId,
    [id, auth.session.organizationId],
  );
  const item = result.rows[0];
  if (!item) return NextResponse.json({ error: "Evento de auditoria não encontrado" }, { status: 404 });
  return NextResponse.json({ item: {
    id: item.id, origin: item.origin, queryType: item.query_type, status: item.status,
    errorCode: item.error_code, durationMs: item.duration_ms, createdAt: item.created_at.toISOString(),
    sanitizedInput: item.sanitized_input, parameters: item.parameters_json || {}, resultSummary: item.result_summary || {},
    actorName: item.actor_name,
  } });
}
