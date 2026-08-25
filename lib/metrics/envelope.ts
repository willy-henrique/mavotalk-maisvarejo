import { NextResponse } from "next/server";
import type { MetricsErrorCode, MetricsMeta } from "@/lib/metrics/types";

const STATUS: Record<MetricsErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid_request: 400,
  invalid_period: 400,
  period_too_long: 400,
  rate_limited: 429,
  internal: 500,
};

export function metricsEnvelope<T>(data: T, meta: MetricsMeta): NextResponse {
  return NextResponse.json({ data, meta });
}

export function metricsError(code: MetricsErrorCode, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: STATUS[code] });
}
