import { mavoConfig } from "@/lib/config/mavo-config";
import { businessAnalyticsService } from "@/lib/business-analytics/business-analytics-service";
import {
  parseBusinessPeriod,
  previousComparablePeriod,
} from "@/lib/business-analytics/business-period-parser";
import {
  parseBusinessIntent,
  requestedLimit,
} from "@/lib/business-analytics/business-query-intents";
import {
  businessMenu,
  formatAverageDaily,
  formatAverageTicket,
  formatBusinessSummary,
  formatComparison,
  formatFreshness,
  formatInventoryEntries,
  formatProductRanking,
  formatSalesByDay,
  formatSalesByWeekday,
  formatSalesCount,
  formatSalesTotals,
  noDataMessage,
} from "@/lib/business-analytics/business-response-formatter";
import type { BusinessAnalyticsContext } from "@/lib/business-analytics/types";
import { consumeRateLimit, rateLimitSubject } from "@/lib/security/rate-limit";

async function emptyResponse(context: BusinessAnalyticsContext): Promise<string> {
  return noDataMessage(await businessAnalyticsService.getDataFreshness(context));
}

export async function routeBusinessQuery(
  context: BusinessAnalyticsContext,
  input: string,
  options: { userName?: string } = {},
): Promise<{ intent: string; reply: string; authorizedActivity: boolean }> {
  const limitResult = await consumeRateLimit(
    "business-query",
    rateLimitSubject(`${context.organizationId}:${context.accessUserId || context.applicationUserId}`),
    mavoConfig.businessQueryRateLimitPerMinute,
    60,
  );
  if (!limitResult.allowed) {
    return {
      intent: "rate_limited",
      reply: limitResult.unavailable
        ? "As consultas gerenciais estão temporariamente indisponíveis. Tente novamente em instantes."
        : `Você fez muitas consultas em sequência. Tente novamente em ${limitResult.retryAfterSeconds} segundos.`,
      authorizedActivity: false,
    };
  }

  const intent = parseBusinessIntent(input);
  if (intent === "help") {
    return {
      intent,
      reply: businessMenu(options.userName),
      authorizedActivity: true,
    };
  }
  if (intent === "unknown") {
    return {
      intent,
      reply:
        "Não consegui identificar a consulta. Você pode perguntar, por exemplo: “Quanto vendemos hoje?”, “Quais foram os produtos mais vendidos?” ou digitar “menu”.",
      authorizedActivity: false,
    };
  }

  const period = parseBusinessPeriod(input, {
    timezone: mavoConfig.defaultTimezone,
    defaultPeriod: "month",
  });
  const limit = requestedLimit(input);

  if (intent === "sales_total") {
    const result = await businessAnalyticsService.getSalesTotal(
      context,
      period,
      input,
    );
    return {
      intent,
      reply: result.hasData ? formatSalesTotals(result) : await emptyResponse(context),
      authorizedActivity: true,
    };
  }
  if (intent === "sales_count") {
    const result = await businessAnalyticsService.getSalesCount(
      context,
      period,
      input,
    );
    return {
      intent,
      reply: result.hasData ? formatSalesCount(result) : await emptyResponse(context),
      authorizedActivity: true,
    };
  }
  if (intent === "average_ticket") {
    const result = await businessAnalyticsService.getAverageTicket(
      context,
      period,
      input,
    );
    return {
      intent,
      reply: result.hasData ? formatAverageTicket(result) : await emptyResponse(context),
      authorizedActivity: true,
    };
  }
  if (intent === "average_daily_sales") {
    const result = await businessAnalyticsService.getAverageSalesPerDay(
      context,
      period,
      input,
    );
    return {
      intent,
      reply: result.hasData ? formatAverageDaily(result) : await emptyResponse(context),
      authorizedActivity: true,
    };
  }
  if (intent === "sales_by_day") {
    const result = await businessAnalyticsService.getSalesByDay(
      context,
      period,
      20,
      input,
    );
    return {
      intent,
      reply: result.length
        ? formatSalesByDay(period.label, result)
        : await emptyResponse(context),
      authorizedActivity: true,
    };
  }
  if (intent === "sales_by_weekday") {
    const result = await businessAnalyticsService.getSalesByWeekday(
      context,
      period,
      input,
    );
    return {
      intent,
      reply: result.length
        ? formatSalesByWeekday(period.label, result)
        : await emptyResponse(context),
      authorizedActivity: true,
    };
  }
  if (intent === "top_selling_products") {
    const result = await businessAnalyticsService.getTopSellingProducts(
      context,
      period,
      limit,
      input,
    );
    return {
      intent,
      reply: result.length
        ? formatProductRanking("Produtos mais vendidos", period.label, result)
        : await emptyResponse(context),
      authorizedActivity: true,
    };
  }
  if (intent === "low_selling_products") {
    const result = await businessAnalyticsService.getLowSellingProducts(
      context,
      period,
      limit,
      input,
    );
    return {
      intent,
      reply: result.length
        ? formatProductRanking("Produtos com menor venda", period.label, result)
        : await emptyResponse(context),
      authorizedActivity: true,
    };
  }
  if (intent === "inventory_entries") {
    const result = await businessAnalyticsService.getInventoryEntries(
      context,
      period,
      limit,
      input,
    );
    return {
      intent,
      reply: result.length
        ? formatInventoryEntries(period.label, result)
        : await emptyResponse(context),
      authorizedActivity: true,
    };
  }
  if (intent === "compare_sales_periods") {
    const previous = previousComparablePeriod(period);
    const result = await businessAnalyticsService.compareSalesPeriods(
      context,
      period,
      previous,
      input,
    );
    return {
      intent,
      reply:
        result.current.hasData || result.previous.hasData
          ? formatComparison(result)
          : await emptyResponse(context),
      authorizedActivity: true,
    };
  }
  if (intent === "data_freshness") {
    return {
      intent,
      reply: formatFreshness(
        await businessAnalyticsService.getDataFreshness(context),
      ),
      authorizedActivity: true,
    };
  }

  const summary = await businessAnalyticsService.getBusinessSummary(
    context,
    period,
    input,
  );
  return {
    intent: "business_summary",
    reply: summary.totals.hasData
      ? formatBusinessSummary(summary)
      : await emptyResponse(context),
    authorizedActivity: true,
  };
}
