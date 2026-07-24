import { businessAnalyticsService } from "@/lib/business-analytics/business-analytics-service";
import type { BusinessToolDefinition } from "@/lib/mcp/types";
import { limitedPeriodInputSchema, toolPeriod } from "@/lib/mcp/tools/shared";

export const getTopProductsTool: BusinessToolDefinition = {
  name: "get_top_selling_products",
  title: "Produtos mais vendidos",
  description: "Retorna ranking somente leitura dos produtos mais vendidos.",
  inputSchema: limitedPeriodInputSchema,
  requiredPermission: "sales.read",
  execute: (context, input) =>
    businessAnalyticsService.getTopSellingProducts(
      context,
      toolPeriod(input),
      Number(input.limit || 10),
    ),
};
