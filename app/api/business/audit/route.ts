import { NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/api";
import { queryDatabase } from "@/lib/db";

export async function GET(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = requireRole(["admin"], auth.session.role);
  if (denied) return denied;
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("pageSize")) || 25),
  );
  const offset = (page - 1) * pageSize;
  const [items, count] = await Promise.all([
    queryDatabase<{
      id: string;
      organization_id: string;
      access_user_id: string | null;
      application_user_id: string | null;
      phone_normalized: string | null;
      origin: string;
      query_type: string;
      status: string;
      error_code: string | null;
      duration_ms: number;
      created_at: Date;
      actor_name: string | null;
    }>(
      `SELECT a.id, a.organization_id, a.access_user_id, a.application_user_id,
              a.phone_normalized, a.origin, a.query_type, a.status,
              a.error_code, a.duration_ms, a.created_at,
              COALESCE(bau.name, u.name) AS actor_name
         FROM business_query_audit a
         LEFT JOIN business_access_users bau
           ON bau.id = a.access_user_id
          AND bau.organization_id = a.organization_id
         LEFT JOIN users u
           ON u.id = a.application_user_id
          AND u.organization_id = a.organization_id
        WHERE a.organization_id = $1
        ORDER BY a.created_at DESC
        LIMIT $2 OFFSET $3`,
      [auth.session.organizationId, pageSize, offset],
    ),
    queryDatabase<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM business_query_audit
        WHERE organization_id = $1`,
      [auth.session.organizationId],
    ),
  ]);
  return NextResponse.json({
    items: items.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      accessUserId: row.access_user_id,
      applicationUserId: row.application_user_id,
      phoneNormalized: row.phone_normalized,
      actorName: row.actor_name,
      origin: row.origin,
      queryType: row.query_type,
      status: row.status,
      errorCode: row.error_code,
      durationMs: row.duration_ms,
      createdAt: row.created_at.toISOString(),
    })),
    total: Number(count.rows[0]?.count || 0),
    page,
    pageSize,
  });
}
