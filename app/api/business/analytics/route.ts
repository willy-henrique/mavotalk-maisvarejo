import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { requireFeature } from "@/lib/config/mavo-config";
import { businessAnalyticsService } from "@/lib/business-analytics/business-analytics-service";
import {
  analyticsContextFromSession,
  periodFromUrl,
} from "@/lib/business-analytics/business-api-context";
import { sanitizedError } from "@/lib/observability";

export async function GET(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "business", "read");
  if (denied) return denied;
  try {
    requireFeature("businessAnalyticsEnabled");
    const period = periodFromUrl(new URL(request.url));
    const context = analyticsContextFromSession(auth.session);
    const [summary, salesByDay, salesByWeekday, topProducts, inventory, freshness] =
      await Promise.all([
        businessAnalyticsService.getBusinessSummary(context, period),
        businessAnalyticsService.getSalesByDay(context, period, 20),
        businessAnalyticsService.getSalesByWeekday(context, period),
        businessAnalyticsService.getTopSellingProducts(context, period, 10),
        businessAnalyticsService.getInventoryEntries(context, period, 10),
        businessAnalyticsService.getDataFreshness(context),
      ]);
    return NextResponse.json({
      period,
      summary,
      salesByDay,
      salesByWeekday,
      topProducts,
      inventory,
      freshness,
    });
  } catch (error) {
    return NextResponse.json(
      { error: sanitizedError(error) },
      { status: Number((error as { status?: number }).status || 500) },
    );
  }
}
