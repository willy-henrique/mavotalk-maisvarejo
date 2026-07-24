import { NextResponse } from "next/server";
import { checkDatabaseConnection } from "@/lib/db";
import { checkRedisConnection } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const [database, redis] = await Promise.all([
    checkDatabaseConnection(),
    checkRedisConnection(),
  ]);
  const ready = database && redis;
  return NextResponse.json(
    {
      ready,
      database: database ? "connected" : "unavailable",
      redis: redis ? "connected" : "unavailable",
      timestamp: new Date().toISOString(),
    },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}
