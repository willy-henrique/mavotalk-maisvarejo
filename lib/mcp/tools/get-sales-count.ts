import { businessAnalyticsService } from "@/lib/business-analytics/business-analytics-service";
import type { BusinessToolDefinition } from "@/lib/mcp/types";
import { periodInputSchema, toolPeriod } from "@/lib/mcp/tools/shared";

export const getSalesCountTool: BusinessToolDefinition = {
  name: "get_sales_count",
  title: "Quantidade de vendas",
  description: "Retorna a quantidade de vendas no período autenticado.",
  inputSchema: periodInputSchema,
  requiredPermission: "sales.read",
  execute: (context, input) =>
    businessAnalyticsService.getSalesCount(context, toolPeriod(input)),
};
