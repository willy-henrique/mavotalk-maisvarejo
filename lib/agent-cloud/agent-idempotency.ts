import { getRedis } from "@/lib/redis";
import { reserveNonceInDatabase } from "@/lib/agent-cloud/agent-repository";
import { recordsChecksum } from "@/lib/agent-cloud/agent-signature";

export async function reserveAgentNonce(
  agentId: string,
  nonce: string,
  ttlSeconds: number,
): Promise<boolean> {
  const environment =
    process.env.MAVO_QUEUE_ENV || process.env.NODE_ENV || "development";
  const redis = getRedis();
  if (redis) {
    try {
      if (redis.status === "wait") await redis.connect();
      const result = await redis.set(
        `mavo-talk:${environment}:agent-nonce:${agentId}:${nonce}`,
        "1",
        "EX",
        ttlSeconds,
        "NX",
      );
      return result === "OK";
    } catch {
      // O fallback PostgreSQL mantém a proteção contra replay.
    }
  }
  return reserveNonceInDatabase(
    agentId,
    nonce,
    new Date(Date.now() + ttlSeconds * 1_000),
  );
}

export function assertRecordsChecksum(
  records: unknown[],
  providedChecksum: string,
): void {
  const calculated = recordsChecksum(records);
  if (calculated !== providedChecksum.toLowerCase()) {
    const error = new Error("Checksum do lote não confere");
    Object.assign(error, { code: "CHECKSUM_MISMATCH", status: 422 });
    throw error;
  }
}
