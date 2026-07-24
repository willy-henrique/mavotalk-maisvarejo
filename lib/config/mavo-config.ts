function booleanValue(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return raw.toLowerCase() === "true";
}

function integerValue(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return fallback;
  }
  return parsed;
}

export const mavoConfig = {
  businessAccessEnabled: booleanValue("MAVO_BUSINESS_ACCESS_ENABLED", false),
  businessAnalyticsEnabled: booleanValue(
    "MAVO_BUSINESS_ANALYTICS_ENABLED",
    false,
  ),
  agentApiEnabled: booleanValue("MAVO_AGENT_API_ENABLED", false),
  mcpEnabled: booleanValue("MAVO_MCP_ENABLED", false),
  defaultTimezone:
    process.env.MAVO_DEFAULT_TIMEZONE || "America/Sao_Paulo",
  defaultCurrency: process.env.MAVO_DEFAULT_CURRENCY || "BRL",
  businessSessionTtlMinutes: integerValue(
    "MAVO_BUSINESS_SESSION_TTL_MINUTES",
    15,
    5,
    240,
  ),
  pinMaxAttempts: integerValue(
    "MAVO_BUSINESS_PIN_MAX_ATTEMPTS",
    5,
    3,
    20,
  ),
  pinLockMinutes: integerValue(
    "MAVO_BUSINESS_PIN_LOCK_MINUTES",
    15,
    1,
    1_440,
  ),
  businessQueryRateLimitPerMinute: integerValue(
    "MAVO_BUSINESS_QUERY_RATE_LIMIT_PER_MINUTE",
    30,
    1,
    1_000,
  ),
  agentClockToleranceSeconds: integerValue(
    "MAVO_AGENT_CLOCK_TOLERANCE_SECONDS",
    300,
    30,
    3_600,
  ),
  agentMaxPayloadBytes: integerValue(
    "MAVO_AGENT_MAX_PAYLOAD_BYTES",
    1_048_576,
    1_024,
    10_485_760,
  ),
  agentRateLimitPerMinute: integerValue(
    "MAVO_AGENT_RATE_LIMIT_PER_MINUTE",
    60,
    1,
    10_000,
  ),
  agentNextSyncSeconds: integerValue(
    "MAVO_AGENT_NEXT_SYNC_SECONDS",
    300,
    30,
    86_400,
  ),
} as const;

export function requireFeature(
  feature:
    | "businessAccessEnabled"
    | "businessAnalyticsEnabled"
    | "agentApiEnabled"
    | "mcpEnabled",
): void {
  if (!mavoConfig[feature]) {
    const error = new Error("Funcionalidade desabilitada");
    Object.assign(error, { code: "FEATURE_DISABLED", status: 404 });
    throw error;
  }
}
