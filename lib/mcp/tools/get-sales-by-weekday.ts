import { businessAnalyticsService } from "@/lib/business-analytics/business-analytics-service";
import type { BusinessToolDefinition } from "@/lib/mcp/types";
import { periodInputSchema, toolPeriod } from "@/lib/mcp/tools/shared";

export const getSalesByWeekdayTool: BusinessToolDefinition = {
  name: "get_sales_by_weekday",
  title: "Vendas por dia da semana",
  description: "Agrupa as vendas por dia da semana no tenant autenticado.",
  inputSchema: periodInputSchema,
  requiredPermission: "finance.read",
  execute: (context, input) =>
    businessAnalyticsService.getSalesByWeekday(context, toolPeriod(input)),
};
