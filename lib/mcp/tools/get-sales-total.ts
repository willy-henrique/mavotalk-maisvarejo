import { businessAnalyticsService } from "@/lib/business-analytics/business-analytics-service";
import type { BusinessToolDefinition } from "@/lib/mcp/types";
import { periodInputSchema, toolPeriod } from "@/lib/mcp/tools/shared";

export const getSalesTotalTool: BusinessToolDefinition = {
  name: "get_sales_total",
  title: "Total de vendas",
  description:
    "Retorna totais de vendas agregados para um período autorizado. Não aceita organization_id nem SQL.",
  inputSchema: periodInputSchema,
  requiredPermission: "finance.read",
  execute: (context, input) =>
    businessAnalyticsService.getSalesTotal(context, toolPeriod(input)),
};
