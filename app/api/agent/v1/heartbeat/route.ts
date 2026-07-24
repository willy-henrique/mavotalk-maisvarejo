import { NextResponse } from "next/server";
import { heartbeatPayloadSchema } from "@/lib/agent-cloud/agent-payload-schemas";
import { processAgentHeartbeat } from "@/lib/agent-cloud/agent-status-service";
import { agentServiceError, authenticatedAgentPayload } from "../_shared";

export async function POST(request: Request) {
  const auth = await authenticatedAgentPayload(request, heartbeatPayloadSchema);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(
      await processAgentHeartbeat(auth.context, auth.payload),
    );
  } catch (error) {
    return agentServiceError(error, auth.requestId);
  }
}
