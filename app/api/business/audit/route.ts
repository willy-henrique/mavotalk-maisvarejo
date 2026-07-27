import { NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/api";
import { queryTenantDatabase } from "@/lib/db";

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
  const query = String(url.searchParams.get("query") || "").trim().slice(0, 120);
  const status = String(url.searchParams.get("status") || "").trim().slice(0, 32);
  const origin = String(url.searchParams.get("origin") || "").trim().slice(0, 32);
  const from = String(url.searchParams.get("from") || "").trim();
  const to = String(url.searchParams.get("to") || "").trim();
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const where = ["a.organization_id = $1"];
  const values: unknown[] = [auth.session.organizationId];
  const addValue = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  if (query) {
    const placeholder = addValue(`%${query}%`);
    where.push(`(a.query_type ILIKE ${placeholder} OR a.origin ILIKE ${placeholder} OR COALESCE(bau.name, u.name, '') ILIKE ${placeholder})`);
  }
  if (status) where.push(`a.status = ${addValue(status)}`);
  if (origin) where.push(`a.origin = ${addValue(origin)}`);
  if (datePattern.test(from)) where.push(`a.created_at >= ${addValue(from)}::date`);
  if (datePattern.test(to)) where.push(`a.created_at < (${addValue(to)}::date + interval '1 day')`);
  const whereClause = where.join(" AND ");
  const listValues = [...values, pageSize, offset];
  const [items, count] = await Promise.all([
    queryTenantDatabase<{
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
        WHERE ${whereClause}
        ORDER BY a.created_at DESC
        LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      auth.session.organizationId,
      listValues,
    ),
    queryTenantDatabase<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM business_query_audit a
         LEFT JOIN business_access_users bau ON bau.id = a.access_user_id AND bau.organization_id = a.organization_id
         LEFT JOIN users u ON u.id = a.application_user_id AND u.organization_id = a.organization_id
        WHERE ${whereClause}`,
      auth.session.organizationId,
      values,
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
