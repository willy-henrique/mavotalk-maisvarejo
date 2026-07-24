import { isIP } from "node:net";
import { mavoConfig, requireFeature } from "@/lib/config/mavo-config";
import { getAgentCredential, recordAgentAudit } from "@/lib/agent-cloud/agent-repository";
import { reserveAgentNonce } from "@/lib/agent-cloud/agent-idempotency";
import { verifyAgentSignature } from "@/lib/agent-cloud/agent-signature";
import type { AgentContext } from "@/lib/agent-cloud/types";
import { consumeRateLimit, rateLimitSubject } from "@/lib/security/rate-limit";

export class AgentApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

function sourceIp(request: Request): string | null {
  const candidate = (request.headers.get("x-forwarded-for") || "")
    .split(",")[0]
    .trim();
  return isIP(candidate) ? candidate : null;
}

function requiredHeader(request: Request, name: string): string {
  const value = request.headers.get(name)?.trim();
  if (!value) throw new AgentApiError("MISSING_AUTH_HEADER", 401, "Autenticação ausente");
  return value;
}

export async function authenticateAgentRequest(input: {
  request: Request;
  rawBody: string;
  requestId: string;
}): Promise<AgentContext> {
  requireFeature("agentApiEnabled");
  if (Buffer.byteLength(input.rawBody, "utf8") > mavoConfig.agentMaxPayloadBytes) {
    throw new AgentApiError("PAYLOAD_TOO_LARGE", 413, "Payload excede o limite permitido");
  }

  const installationKey = requiredHeader(input.request, "x-mavo-agent-id");
  const timestamp = requiredHeader(input.request, "x-mavo-timestamp");
  const nonce = requiredHeader(input.request, "x-mavo-nonce");
  const signature = requiredHeader(input.request, "x-mavo-signature");
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(nonce)) {
    throw new AgentApiError("INVALID_NONCE", 401, "Nonce inválido");
  }

  const unixSeconds = Number(timestamp);
  if (!Number.isInteger(unixSeconds)) {
    throw new AgentApiError("INVALID_TIMESTAMP", 401, "Timestamp inválido");
  }
  const skew = Math.abs(Math.floor(Date.now() / 1_000) - unixSeconds);
  if (skew > mavoConfig.agentClockToleranceSeconds) {
    throw new AgentApiError("EXPIRED_TIMESTAMP", 401, "Timestamp fora da tolerância");
  }

  const credential = await getAgentCredential(installationKey);
  if (!credential) {
    throw new AgentApiError("INVALID_AGENT", 401, "Credencial inválida ou revogada");
  }

  const context: AgentContext = {
    agentId: credential.agentId,
    installationKey: credential.installationKey,
    organizationId: credential.organizationId,
    agentName: credential.agentName,
    keyVersion: credential.keyVersion,
    requestId: input.requestId,
    sourceIp: sourceIp(input.request),
  };

  const limit = await consumeRateLimit(
    "agent",
    rateLimitSubject(credential.agentId),
    mavoConfig.agentRateLimitPerMinute,
    60,
  );
  if (!limit.allowed) {
    throw new AgentApiError(
      limit.unavailable ? "RATE_LIMIT_UNAVAILABLE" : "RATE_LIMITED",
      limit.unavailable ? 503 : 429,
      limit.unavailable
        ? "Proteção da API temporariamente indisponível"
        : "Limite de requisições excedido",
      limit.retryAfterSeconds,
    );
  }

  const path = new URL(input.request.url).pathname;
  if (
    !verifyAgentSignature(credential.secret, signature, {
      method: input.request.method,
      path,
      timestamp,
      nonce,
      rawBody: input.rawBody,
    })
  ) {
    await recordAgentAudit({
      context,
      organizationId: context.organizationId,
      requestId: input.requestId,
      eventType: "signature_verification",
      status: "rejected",
      errorCode: "INVALID_SIGNATURE",
    }).catch(() => undefined);
    throw new AgentApiError("INVALID_SIGNATURE", 401, "Assinatura inválida");
  }

  const reserved = await reserveAgentNonce(
    credential.agentId,
    nonce,
    mavoConfig.agentClockToleranceSeconds * 2,
  );
  if (!reserved) {
    throw new AgentApiError("REPLAY_DETECTED", 409, "Nonce já utilizado");
  }
  return context;
}
