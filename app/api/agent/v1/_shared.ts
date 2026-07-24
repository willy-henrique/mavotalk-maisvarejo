import { NextResponse } from "next/server";
import type { z } from "zod";
import { AgentApiError, authenticateAgentRequest } from "@/lib/agent-cloud/agent-auth-service";
import { mavoConfig } from "@/lib/config/mavo-config";
import { requestIdFrom, sanitizedError, structuredOperationLog } from "@/lib/observability";

async function readRawBodyWithLimit(request: Request): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > mavoConfig.agentMaxPayloadBytes
  ) {
    throw new AgentApiError(
      "PAYLOAD_TOO_LARGE",
      413,
      "Payload excede o limite permitido",
    );
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let rawBody = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > mavoConfig.agentMaxPayloadBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AgentApiError(
        "PAYLOAD_TOO_LARGE",
        413,
        "Payload excede o limite permitido",
      );
    }
    rawBody += decoder.decode(value, { stream: true });
  }
  return rawBody + decoder.decode();
}

export async function authenticatedAgentPayload<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<
  | {
      ok: true;
      context: Awaited<ReturnType<typeof authenticateAgentRequest>>;
      payload: T;
      requestId: string;
    }
  | { ok: false; response: NextResponse }
> {
  const requestId = requestIdFrom(request);
  const startedAt = Date.now();
  try {
    if (
      request.method !== "GET" &&
      !request.headers.get("content-type")?.toLowerCase().includes("application/json")
    ) {
      throw new AgentApiError(
        "UNSUPPORTED_CONTENT_TYPE",
        415,
        "Content-Type deve ser application/json",
      );
    }
    const rawBody =
      request.method === "GET" ? "" : await readRawBodyWithLimit(request);
    const context = await authenticateAgentRequest({ request, rawBody, requestId });
    let json: unknown = {};
    if (rawBody) {
      try {
        json = JSON.parse(rawBody);
      } catch {
        throw new AgentApiError("INVALID_JSON", 400, "JSON inválido");
      }
    }
    if (
      json &&
      typeof json === "object" &&
      "schemaVersion" in json &&
      (json as { schemaVersion?: unknown }).schemaVersion !== "1.0"
    ) {
      throw new AgentApiError(
        "UNSUPPORTED_SCHEMA_VERSION",
        422,
        "Versão de payload não suportada",
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: {
              code: "INVALID_PAYLOAD",
              message: "Payload inválido",
              issues: parsed.error.issues.slice(0, 20).map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
              })),
            },
            requestId,
          },
          { status: 422 },
        ),
      };
    }
    return { ok: true, context, payload: parsed.data, requestId };
  } catch (error) {
    const agentError =
      error instanceof AgentApiError
        ? error
        : new AgentApiError(
            String((error as { code?: string }).code || "INTERNAL_ERROR"),
            Number((error as { status?: number }).status || 500),
            sanitizedError(error).message,
          );
    structuredOperationLog(
      {
        requestId,
        durationMs: Date.now() - startedAt,
        status: "rejected",
        error: agentError,
      },
      "Agent API request rejected",
    );
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: { code: agentError.code, message: agentError.message },
          requestId,
          serverTime: new Date().toISOString(),
        },
        {
          status: agentError.status,
          headers: agentError.retryAfterSeconds
            ? { "Retry-After": String(agentError.retryAfterSeconds) }
            : undefined,
        },
      ),
    };
  }
}

export function agentServiceError(error: unknown, requestId: string) {
  const sanitized = sanitizedError(error);
  const status = Math.min(
    599,
    Math.max(400, Number((error as { status?: number }).status || 500)),
  );
  return NextResponse.json(
    { error: sanitized, requestId, serverTime: new Date().toISOString() },
    { status },
  );
}
