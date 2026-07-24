import IORedis from "ioredis";
import { logger } from "@/lib/logger";
import { sanitizedError } from "@/lib/observability";

declare global {
  var __mavoRedis: IORedis | undefined;
}

export function getRedis(): IORedis | null {
  if (!process.env.REDIS_URL) return null;
  if (global.__mavoRedis) return global.__mavoRedis;
  const redis = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    lazyConnect: true,
    enableReadyCheck: true,
  });
  redis.on("error", (error) => {
    logger.warn({ error: sanitizedError(error) }, "Redis connection error");
  });
  global.__mavoRedis = redis;
  return redis;
}

export async function checkRedisConnection(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    if (redis.status === "wait") await redis.connect();
    return (await redis.ping()) === "PONG";
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  const redis = global.__mavoRedis;
  if (!redis) return;
  global.__mavoRedis = undefined;
  await redis.quit().catch(() => redis.disconnect());
}
