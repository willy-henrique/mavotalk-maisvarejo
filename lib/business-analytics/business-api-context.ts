import type { SessionPayload } from "@/lib/auth";
import type {
  BusinessAnalyticsContext,
  BusinessPeriod,
} from "@/lib/business-analytics/types";
import { mavoConfig } from "@/lib/config/mavo-config";
import {
  businessPeriodFromIsoRange,
  parseBusinessPeriod,
} from "@/lib/business-analytics/business-period-parser";

export function analyticsContextFromSession(
  session: SessionPayload,
): BusinessAnalyticsContext {
  const permissions =
    session.role === "admin"
      ? new Set([
          "sales.read",
          "finance.read",
          "inventory.read",
          "audit.read",
          "access.manage",
        ] as const)
      : session.role === "gestor"
        ? new Set(["sales.read", "finance.read", "inventory.read"] as const)
        : new Set<never>();
  return {
    organizationId: session.organizationId,
    applicationUserId: session.userId,
    origin: "ui",
    permissions,
  };
}

export function periodFromUrl(url: URL): BusinessPeriod {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from || to) {
    if (!from || !to) {
      const error = new Error("Intervalo inválido");
      Object.assign(error, { code: "INVALID_PERIOD", status: 400 });
      throw error;
    }
    return businessPeriodFromIsoRange({
      from,
      to,
      label: `${from.split("-").reverse().join("/")} a ${to.split("-").reverse().join("/")}`,
      timezone: mavoConfig.defaultTimezone,
    });
  }
  return parseBusinessPeriod(url.searchParams.get("period") || "este mês", {
    timezone: mavoConfig.defaultTimezone,
  });
}
