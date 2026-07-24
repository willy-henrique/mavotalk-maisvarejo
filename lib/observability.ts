import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";

export function requestIdFrom(request: Request): string {
  const existing = request.headers.get("x-request-id")?.trim();
  return existing && existing.length <= 200 ? existing : randomUUID();
}

export function sanitizeBusinessAuditInput(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  return value
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[email redigido]",
    )
    .replace(
      /\b(pin|senha|token|segredo|secret)\s*[:=-]?\s*\S+/gi,
      "$1 [redigido]",
    )
    .replace(/\b(?:\d[\s().+-]*){6,}\b/g, "[número redigido]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function sanitizedError(error: unknown): {
  code: string;
  message: string;
} {
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    status?: unknown;
  };
  const candidateCode =
    typeof candidate?.code === "string" &&
    /^[A-Z0-9_:-]{1,80}$/i.test(candidate.code)
      ? candidate.code
      : "INTERNAL_ERROR";
  const status = Number(candidate?.status);
  const explicitlySafe =
    Number.isInteger(status) && status >= 400 && status < 500;
  if (!explicitlySafe) {
    return { code: "INTERNAL_ERROR", message: "Erro interno" };
  }
  return {
    code: candidateCode,
    message: String(candidate?.message || "Operação não concluída").slice(
      0,
      200,
    ),
  };
}

export function structuredOperationLog(
  fields: {
    requestId?: string;
    organizationId?: string;
    agentId?: string;
    batchId?: string;
    queryType?: string;
    durationMs: number;
    status: string;
    error?: unknown;
  },
  message: string,
): void {
  const payload = {
    request_id: fields.requestId,
    organization_id: fields.organizationId,
    agent_id: fields.agentId,
    batch_id: fields.batchId,
    query_type: fields.queryType,
    duration_ms: fields.durationMs,
    status: fields.status,
    error: fields.error ? sanitizedError(fields.error) : undefined,
  };
  if (fields.error) logger.error(payload, message);
  else logger.info(payload, message);
}
