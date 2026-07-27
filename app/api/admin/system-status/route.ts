import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { checkDatabaseConnection, queryTenantDatabase } from "@/lib/db";
import { checkRedisConnection } from "@/lib/redis";
import { getWhatsappState } from "@/lib/whatsapp-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "business_sync", "read");
  if (denied) return denied;

  const [database, redis, agents] = await Promise.all([
    checkDatabaseConnection(),
    checkRedisConnection(),
    queryTenantDatabase<{
      last_sync_at: Date | null;
      last_heartbeat_at: Date | null;
      active_agents: string;
    }>(
      auth.session.organizationId,
      `SELECT MAX(last_sync_at) AS last_sync_at,
              MAX(last_heartbeat_at) AS last_heartbeat_at,
              COUNT(*) FILTER (WHERE revoked_at IS NULL)::text AS active_agents
         FROM agent_installations
        WHERE organization_id = $1`,
      [auth.session.organizationId],
    ).catch(() => ({ rows: [] })),
  ]);
  const agent = agents.rows[0];
  const whatsapp = getWhatsappState();
  return NextResponse.json({
    status: database && redis ? "ok" : "degraded",
    services: {
      supabase: database ? "connected" : "unavailable",
      redis: redis ? "connected" : "unavailable",
      whatsapp: whatsapp.status,
      worker: redis ? "configured" : "unknown",
    },
    whatsapp: {
      status: whatsapp.status,
      connectedPhone: whatsapp.connectedPhone,
      lastError: whatsapp.lastError ? "WHATSAPP_CONNECTION_ERROR" : null,
    },
    agents: {
      active: Number(agent?.active_agents || 0),
      lastHeartbeatAt: agent?.last_heartbeat_at?.toISOString() || null,
      lastSyncAt: agent?.last_sync_at?.toISOString() || null,
    },
    version:
      process.env.APP_VERSION ||
      process.env.RENDER_GIT_COMMIT?.slice(0, 12) ||
      "development",
    timestamp: new Date().toISOString(),
  });
}
