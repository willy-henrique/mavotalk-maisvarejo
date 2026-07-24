import { NextResponse } from "next/server";
import { salesDailyPayloadSchema } from "@/lib/agent-cloud/agent-payload-schemas";
import { ingestAgentBatch } from "@/lib/agent-cloud/agent-ingestion-service";
import { agentServiceError, authenticatedAgentPayload } from "../../_shared";

export async function POST(request: Request) {
  const auth = await authenticatedAgentPayload(request, salesDailyPayloadSchema);
  if (!auth.ok) return auth.response;
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return NextResponse.json(
      {
        error: {
          code: "MISSING_IDEMPOTENCY_KEY",
          message: "Idempotency-Key é obrigatório",
        },
        requestId: auth.requestId,
      },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(
      await ingestAgentBatch({
        context: auth.context,
        dataType: "sales_daily",
        payload: auth.payload,
        idempotencyKey,
      }),
    );
  } catch (error) {
    return agentServiceError(error, auth.requestId);
  }
}
