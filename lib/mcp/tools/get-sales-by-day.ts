import { businessAnalyticsService } from "@/lib/business-analytics/business-analytics-service";
import type { BusinessToolDefinition } from "@/lib/mcp/types";
import { limitedPeriodInputSchema, toolPeriod } from "@/lib/mcp/tools/shared";

export const getSalesByDayTool: BusinessToolDefinition = {
  name: "get_sales_by_day",
  title: "Vendas por dia",
  description: "Lista vendas agregadas por data, com limite máximo de 20.",
  inputSchema: limitedPeriodInputSchema,
  requiredPermission: "finance.read",
  execute: (context, input) =>
    businessAnalyticsService.getSalesByDay(
      context,
      toolPeriod(input),
      Number(input.limit || 10),
    ),
};
