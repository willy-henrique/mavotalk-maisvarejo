import { businessAnalyticsService } from "@/lib/business-analytics/business-analytics-service";
import type { BusinessToolDefinition } from "@/lib/mcp/types";
import { periodInputSchema, toolPeriod } from "@/lib/mcp/tools/shared";

export const getBusinessSummaryTool: BusinessToolDefinition = {
  name: "get_business_summary",
  title: "Resumo do negócio",
  description: "Retorna um resumo gerencial tipado e limitado.",
  inputSchema: periodInputSchema,
  requiredPermission: "finance.read",
  execute: (context, input) =>
    businessAnalyticsService.getBusinessSummary(context, toolPeriod(input)),
};
