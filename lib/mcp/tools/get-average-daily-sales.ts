import { businessAnalyticsService } from "@/lib/business-analytics/business-analytics-service";
import type { BusinessToolDefinition } from "@/lib/mcp/types";
import { periodInputSchema, toolPeriod } from "@/lib/mcp/tools/shared";

export const getAverageDailySalesTool: BusinessToolDefinition = {
  name: "get_average_daily_sales",
  title: "Média diária de vendas",
  description: "Retorna a média de vendas por dia no período solicitado.",
  inputSchema: periodInputSchema,
  requiredPermission: "finance.read",
  execute: (context, input) =>
    businessAnalyticsService.getAverageSalesPerDay(context, toolPeriod(input)),
};
