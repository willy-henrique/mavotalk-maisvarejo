import { NextResponse } from "next/server";
import { checkDatabaseConnection } from "@/lib/db";
import { checkRedisConnection } from "@/lib/redis";
import { getPublicWhatsappStatus } from "@/lib/whatsapp-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const [database, redis] = await Promise.all([
    checkDatabaseConnection(),
    checkRedisConnection(),
  ]);
  const status = database && redis ? "ok" : database ? "degraded" : "unhealthy";
  return NextResponse.json(
    {
      status,
      environment: process.env.NODE_ENV || "development",
      database: database ? "connected" : "unavailable",
      redis: redis ? "connected" : "unavailable",
      whatsapp: getPublicWhatsappStatus(),
      version:
        process.env.APP_VERSION ||
        process.env.RENDER_GIT_COMMIT?.slice(0, 12) ||
        "development",
      timestamp: new Date().toISOString(),
    },
    {
      status: database ? 200 : 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
