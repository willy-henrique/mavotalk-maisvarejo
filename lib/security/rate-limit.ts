import { createHash } from "node:crypto";
import { getRedis } from "@/lib/redis";

type MemoryEntry = { count: number; resetAt: number };
const developmentFallback = new Map<string, MemoryEntry>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  unavailable?: boolean;
};

export function rateLimitSubject(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export async function consumeRateLimit(
  namespace: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const environment = process.env.MAVO_QUEUE_ENV || process.env.NODE_ENV || "development";
  const key = `mavo-talk:${environment}:rate:${namespace}:${subject}`;
  const redis = getRedis();

  if (redis) {
    try {
      if (redis.status === "wait") await redis.connect();
      const result = (await redis.eval(
        `local current = redis.call('INCR', KEYS[1])
         if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
         local ttl = redis.call('TTL', KEYS[1])
         return {current, ttl}`,
        1,
        key,
        windowSeconds,
      )) as [number, number];
      const count = Number(result[0]);
      const retryAfterSeconds = Math.max(1, Number(result[1]));
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds,
      };
    } catch {
      if (process.env.NODE_ENV === "production") {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: 5,
          unavailable: true,
        };
      }
    }
  } else if (process.env.NODE_ENV === "production") {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 5,
      unavailable: true,
    };
  }

  const now = Date.now();
  const previous = developmentFallback.get(key);
  const entry =
    previous && previous.resetAt > now
      ? previous
      : { count: 0, resetAt: now + windowSeconds * 1_000 };
  entry.count += 1;
  developmentFallback.set(key, entry);
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1_000)),
  };
}

export function clearDevelopmentRateLimits(): void {
  developmentFallback.clear();
}
