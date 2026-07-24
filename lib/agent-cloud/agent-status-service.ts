import { mavoConfig } from "@/lib/config/mavo-config";
import { recordAgentAudit, updateAgentHeartbeat } from "@/lib/agent-cloud/agent-repository";
import type { AgentContext } from "@/lib/agent-cloud/types";
import type { z } from "zod";
import type { heartbeatPayloadSchema } from "@/lib/agent-cloud/agent-payload-schemas";

type HeartbeatPayload = z.infer<typeof heartbeatPayloadSchema>;

export async function processAgentHeartbeat(
  context: AgentContext,
  payload: HeartbeatPayload,
): Promise<{
  accepted: true;
  serverTime: string;
  nextHeartbeatAfterSeconds: number;
}> {
  const startedAt = Date.now();
  await updateAgentHeartbeat(context, {
    agentVersion: payload.agentVersion,
    schemaVersion: payload.schemaVersion,
    degraded: payload.status === "degraded",
    errorCode: payload.status === "degraded" ? "AGENT_DEGRADED" : null,
  });
  await recordAgentAudit({
    context,
    organizationId: context.organizationId,
    requestId: context.requestId,
    eventType: "heartbeat",
    status: "success",
    durationMs: Date.now() - startedAt,
    metadata: {
      status: payload.status,
      pendingBatches: payload.details?.pendingBatches ?? 0,
    },
  });
  return {
    accepted: true,
    serverTime: new Date().toISOString(),
    nextHeartbeatAfterSeconds: Math.min(
      300,
      mavoConfig.agentNextSyncSeconds,
    ),
  };
}

export function getAgentConfiguration(context: AgentContext) {
  return {
    schemaVersion: "1.0",
    agentId: context.installationKey,
    sourceTimezone: mavoConfig.defaultTimezone,
    maxPayloadBytes: mavoConfig.agentMaxPayloadBytes,
    maxRecordsPerBatch: 5_000,
    clockToleranceSeconds: mavoConfig.agentClockToleranceSeconds,
    nextSyncAfterSeconds: mavoConfig.agentNextSyncSeconds,
    endpoints: {
      heartbeat: "/api/agent/v1/heartbeat",
      salesDaily: "/api/agent/v1/sync/sales-daily",
      productSales: "/api/agent/v1/sync/product-sales",
      inventoryEntries: "/api/agent/v1/sync/inventory-entries",
    },
  };
}
