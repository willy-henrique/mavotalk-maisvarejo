export type MetricsPeriod = { from: string; to: string };

export type MetricsMeta = {
  period: MetricsPeriod;
  comparison: MetricsPeriod | null;
  timezone: string;
  generatedAt: string;
  filters: Record<string, string | null>;
  granularity?: "hour" | "day";
};

export type MetricsErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_request"
  | "invalid_period"
  | "period_too_long"
  | "rate_limited"
  | "internal";
