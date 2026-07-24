import { businessAnalyticsService } from "@/lib/business-analytics/business-analytics-service";
import type { BusinessToolDefinition } from "@/lib/mcp/types";
import { limitedPeriodInputSchema, toolPeriod } from "@/lib/mcp/tools/shared";

export const getLowSellingProductsTool: BusinessToolDefinition = {
  name: "get_low_selling_products",
  title: "Produtos com menor venda",
  description:
    "Retorna produtos de menor giro, incluindo produtos conhecidos sem venda no período.",
  inputSchema: limitedPeriodInputSchema,
  requiredPermission: "sales.read",
  execute: (context, input) =>
    businessAnalyticsService.getLowSellingProducts(
      context,
      toolPeriod(input),
      Number(input.limit || 10),
    ),
};
